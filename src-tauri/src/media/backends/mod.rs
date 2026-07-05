//! Concrete media backends. Each file below is filled by a Wave 1 worker against the traits in
//! `super::traits`. Uncomment the module as each backend lands.
//!
//! - `comfy`   — ComfyUI ImageGenerator + VideoGenerator (wraps the existing `crate::comfy`)  [Wave 1B]
//! - `sdcpp`   — stable-diffusion.cpp native ImageGenerator                                    [Wave 1D]
//! - `whisper` — whisper.cpp Transcriber                                                       [Wave 1C]
//! - `piper`   — Piper / SAPI SpeechSynthesizer                                                [Wave 1C]
#![allow(dead_code)]

pub mod comfy;
pub mod piper;
pub mod sdcpp;
pub mod whisper;
