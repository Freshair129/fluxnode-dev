//! GPU arbiter — serializes the FluxNode brain with FluxNode-owned heavy media work.
//!
//! Heavy jobs ask only models used by FluxNode to unload. Each lease records which models were
//! resident and restores only those FluxNode actually evicted.
#![allow(dead_code)]

use std::sync::{Arc, Condvar, Mutex};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GpuNeed {
    /// GPU media (image / video / NVENC) — unload every FluxNode-used brain if resident.
    Heavy,
    /// A small job that may coexist with a small brain (policy-configurable; today it still
    /// serializes but does not evict the brain).
    Light,
}

/// Hook a FluxNode-used brain implements so the arbiter can free and restore its VRAM.
/// `unload` returns true only when this model was resident and was successfully evicted.
pub trait BrainVram: Send + Sync {
    /// Stable normalized endpoint and model identities for the FluxNode-owned brain.
    fn managed_endpoint_identity(&self) -> String;
    fn managed_model_identity(&self) -> String;
    fn unload(&self) -> Result<bool, String>;
    fn reload(&self) -> Result<(), String>;
}

/// Serializes GPU access across the configured FluxNode brain and its heavy media jobs.
pub struct GpuArbiter {
    busy: Mutex<bool>,
    cv: Condvar,
    brains: Mutex<Vec<Arc<dyn BrainVram>>>,
}

impl GpuArbiter {
    pub fn new(brain: Option<Arc<dyn BrainVram>>) -> Arc<Self> {
        Arc::new(Self {
            busy: Mutex::new(false),
            cv: Condvar::new(),
            brains: Mutex::new(brain.into_iter().collect()),
        })
    }

    /// Register a FluxNode-owned model after a successful inference turn. Callers must hold a
    /// lease while doing so, which prevents a heavy job from racing the registration.
    pub fn register_brain(&self, brain: Arc<dyn BrainVram>) {
        let endpoint = brain.managed_endpoint_identity();
        let model = brain.managed_model_identity();
        let mut brains = self.brains.lock().unwrap_or_else(|p| p.into_inner());
        if !brains.iter().any(|registered| {
            registered.managed_endpoint_identity() == endpoint
                && registered.managed_model_identity() == model
        }) {
            brains.push(brain);
        }
    }

    /// Acquire exclusive GPU access, blocking until it is free. A failed unload aborts the job
    /// and releases the busy flag so later callers cannot deadlock behind a failed handoff.
    pub fn acquire(self: &Arc<Self>, need: GpuNeed) -> Result<GpuLease, String> {
        {
            let mut busy = self.busy.lock().unwrap_or_else(|p| p.into_inner());
            while *busy {
                busy = self.cv.wait(busy).unwrap_or_else(|p| p.into_inner());
            }
            *busy = true;
        }

        let brains = self
            .brains
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone();
        let mut models_to_restore = Vec::new();
        if need == GpuNeed::Heavy {
            for brain in brains {
                match brain.unload() {
                    Ok(true) => models_to_restore.push(brain),
                    Ok(false) => {}
                    Err(error) => {
                        let restore_error = reload_brains(&models_to_restore).err();
                        self.release_busy();
                        let message =
                            format!("GPU handoff failed before media work started: {error}");
                        return Err(match restore_error {
                            Some(restore_error) => format!(
                                "{message}; additionally, FluxNode could not restore previously evicted brains: {}",
                                restore_error.join("; ")
                            ),
                            None => message,
                        });
                    }
                }
            }
        }

        Ok(GpuLease {
            arbiter: self.clone(),
            restore_brains: models_to_restore,
            finished: false,
        })
    }

    fn release_busy(&self) {
        let mut busy = self.busy.lock().unwrap_or_else(|p| p.into_inner());
        *busy = false;
        self.cv.notify_all();
    }

    fn release(&self, restore_brains: &[Arc<dyn BrainVram>]) -> Result<(), String> {
        let reload_errors = reload_brains(restore_brains);
        // Even when reload fails, release the lease. The failure is returned to the caller and
        // the `Drop` fallback logs it if a caller forgot to use `finish`.
        self.release_busy();
        reload_errors.map_err(|errors| {
            format!(
                "FluxNode could not restore managed Ollama models: {}",
                errors.join("; ")
            )
        })
    }
}

fn reload_brains(brains: &[Arc<dyn BrainVram>]) -> Result<(), Vec<String>> {
    let errors: Vec<String> = brains
        .iter()
        .filter_map(|brain| {
            brain
                .reload()
                .err()
                .map(|error| format!("{}: {error}", brain.managed_model_identity()))
        })
        .collect();
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

/// Owned lease for a heavy GPU operation. Call `finish` to surface restoration failures; dropping
/// an unfinished lease remains a safe fallback that releases arbitration and logs any error.
pub struct GpuLease {
    arbiter: Arc<GpuArbiter>,
    restore_brains: Vec<Arc<dyn BrainVram>>,
    finished: bool,
}

impl GpuLease {
    pub fn finish(mut self) -> Result<(), String> {
        self.finished = true;
        self.arbiter.release(&self.restore_brains)
    }

    /// Preserve the operation error while also reporting a failed Ollama restore.
    pub fn finish_with<T>(self, operation: Result<T, String>) -> Result<T, String> {
        let restore = self.finish();
        match (operation, restore) {
            (Ok(value), Ok(())) => Ok(value),
            (Ok(_), Err(error)) => Err(format!(
                "GPU work finished, but FluxNode could not restore its Ollama brain: {error}"
            )),
            (Err(operation_error), Ok(())) => Err(operation_error),
            (Err(operation_error), Err(restore_error)) => Err(format!(
                "{operation_error}; additionally, FluxNode could not restore its Ollama brain: {restore_error}"
            )),
        }
    }
}

impl Drop for GpuLease {
    fn drop(&mut self) {
        if !self.finished {
            if let Err(error) = self.arbiter.release(&self.restore_brains) {
                eprintln!("FluxNode GPU lease cleanup failed: {error}");
            }
            self.finished = true;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    struct FakeBrain {
        endpoint: String,
        model: String,
        resident: AtomicBool,
        fail_unload: AtomicBool,
        fail_reload: AtomicBool,
        unload_calls: AtomicUsize,
        reload_calls: AtomicUsize,
    }

    impl FakeBrain {
        fn new(resident: bool) -> Self {
            Self::named("fixture://ollama", "fixture:latest", resident)
        }

        fn named(endpoint: &str, model: &str, resident: bool) -> Self {
            Self {
                endpoint: endpoint.to_string(),
                model: model.to_string(),
                resident: AtomicBool::new(resident),
                fail_unload: AtomicBool::new(false),
                fail_reload: AtomicBool::new(false),
                unload_calls: AtomicUsize::new(0),
                reload_calls: AtomicUsize::new(0),
            }
        }
    }

    impl BrainVram for FakeBrain {
        fn managed_endpoint_identity(&self) -> String {
            self.endpoint.clone()
        }

        fn managed_model_identity(&self) -> String {
            self.model.clone()
        }

        fn unload(&self) -> Result<bool, String> {
            self.unload_calls.fetch_add(1, Ordering::SeqCst);
            if self.fail_unload.load(Ordering::SeqCst) {
                return Err("fixture unload failed".to_string());
            }
            Ok(self.resident.swap(false, Ordering::SeqCst))
        }

        fn reload(&self) -> Result<(), String> {
            self.reload_calls.fetch_add(1, Ordering::SeqCst);
            if self.fail_reload.load(Ordering::SeqCst) {
                return Err("fixture reload failed".to_string());
            }
            self.resident.store(true, Ordering::SeqCst);
            Ok(())
        }
    }

    #[test]
    fn heavy_lease_only_reloads_a_brain_that_was_resident() {
        let brain = Arc::new(FakeBrain::new(false));
        let arbiter = GpuArbiter::new(Some(brain.clone()));
        arbiter
            .acquire(GpuNeed::Heavy)
            .expect("unloaded brain does not prevent heavy work")
            .finish()
            .expect("no restore is needed");

        assert_eq!(brain.unload_calls.load(Ordering::SeqCst), 1);
        assert_eq!(brain.reload_calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn heavy_media_lease_works_when_no_fluxnode_brain_has_been_registered() {
        GpuArbiter::new(None)
            .acquire(GpuNeed::Heavy)
            .expect("standalone media must not require an unused Ollama brain")
            .finish()
            .expect("no brain restore is needed");
    }

    #[test]
    fn managed_model_registration_is_scoped_to_endpoint_and_model_identity() {
        let first = Arc::new(FakeBrain::named(
            "http://127.0.0.1:11434",
            "model:latest",
            false,
        ));
        let same = Arc::new(FakeBrain::named(
            "http://127.0.0.1:11434",
            "model:latest",
            false,
        ));
        let other_endpoint = Arc::new(FakeBrain::named(
            "http://127.0.0.1:11435",
            "model:latest",
            false,
        ));
        let arbiter = GpuArbiter::new(Some(first));

        arbiter.register_brain(same);
        arbiter.register_brain(other_endpoint);

        assert_eq!(arbiter.brains.lock().unwrap().len(), 2);
    }

    #[test]
    fn unload_failure_aborts_job_and_releases_the_arbiter() {
        let brain = Arc::new(FakeBrain::new(true));
        brain.fail_unload.store(true, Ordering::SeqCst);
        let arbiter = GpuArbiter::new(Some(brain));

        let error = match arbiter.acquire(GpuNeed::Heavy) {
            Ok(_lease) => panic!("an unacknowledged unload must block heavy work"),
            Err(error) => error,
        };
        assert!(error.contains("fixture unload failed"));
        arbiter
            .acquire(GpuNeed::Light)
            .expect("failed handoff must not strand the busy flag")
            .finish()
            .expect("light lease has no Ollama restore");
    }

    #[test]
    fn reload_failure_is_returned_and_still_releases_the_arbiter() {
        let brain = Arc::new(FakeBrain::new(true));
        brain.fail_reload.store(true, Ordering::SeqCst);
        let arbiter = GpuArbiter::new(Some(brain));
        let lease = arbiter
            .acquire(GpuNeed::Heavy)
            .expect("resident brain unload succeeds");

        let error = match lease.finish_with(Ok(())) {
            Ok(()) => panic!("reload failure must not be hidden"),
            Err(error) => error,
        };
        assert!(error.contains("fixture reload failed"));
        arbiter
            .acquire(GpuNeed::Light)
            .expect("reload failure must still release the arbiter")
            .finish()
            .expect("light lease has no Ollama restore");
    }

    #[test]
    fn partial_unload_failure_restores_prior_model_and_releases_busy_state() {
        let first = Arc::new(FakeBrain::named("fixture://ollama", "first:latest", true));
        let second = Arc::new(FakeBrain::named("fixture://ollama", "second:latest", true));
        second.fail_unload.store(true, Ordering::SeqCst);
        let arbiter = GpuArbiter::new(Some(first.clone()));
        arbiter.register_brain(second.clone());

        let error = match arbiter.acquire(GpuNeed::Heavy) {
            Ok(_lease) => panic!("a failed second unload must abort the heavy job"),
            Err(error) => error,
        };
        assert!(error.contains("fixture unload failed"));
        assert_eq!(first.reload_calls.load(Ordering::SeqCst), 1);
        assert!(first.resident.load(Ordering::SeqCst));
        assert_eq!(second.reload_calls.load(Ordering::SeqCst), 0);

        arbiter
            .acquire(GpuNeed::Light)
            .expect("partial failure must release the busy flag")
            .finish()
            .expect("light lease does not restore models");
    }

    #[test]
    fn partial_unload_and_restore_failures_are_both_reported() {
        let first = Arc::new(FakeBrain::named("fixture://ollama", "first:latest", true));
        first.fail_reload.store(true, Ordering::SeqCst);
        let second = Arc::new(FakeBrain::named("fixture://ollama", "second:latest", true));
        second.fail_unload.store(true, Ordering::SeqCst);
        let arbiter = GpuArbiter::new(Some(first));
        arbiter.register_brain(second);

        let error = match arbiter.acquire(GpuNeed::Heavy) {
            Ok(_lease) => panic!("a failed second unload must abort the heavy job"),
            Err(error) => error,
        };
        assert!(error.contains("fixture unload failed"));
        assert!(error.contains("fixture reload failed"));
        assert!(error.contains("first:latest"));
        arbiter
            .acquire(GpuNeed::Light)
            .expect("restore failure must still release the busy flag")
            .finish()
            .expect("light lease does not restore models");
    }
}
