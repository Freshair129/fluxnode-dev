import { pickProjectDirectory } from './ipc/file-dialog'

export async function createProjectWithPicker(
  newProject: () => Promise<void>,
  createProjectAtPath: (path: string) => Promise<void>,
  defaultProjectDirectory?: string | null,
) {
  await newProject()
  const path = await pickProjectDirectory(defaultProjectDirectory)

  if (path) {
    await createProjectAtPath(path)
  }
}

export async function openProjectWithPicker(
  openProjectFromPath: (path: string) => Promise<void>,
  defaultProjectDirectory?: string | null,
) {
  const path = await pickProjectDirectory(defaultProjectDirectory)

  if (path) {
    await openProjectFromPath(path)
  }
}

export async function saveProjectAsWithPicker(
  saveProjectAs: (path: string) => Promise<void>,
  defaultProjectDirectory?: string | null,
) {
  const path = await pickProjectDirectory(defaultProjectDirectory)

  if (path) {
    await saveProjectAs(path)
  }
}
