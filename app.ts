type ImageFile = File;
type DirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission: (descriptor: {
    mode: "readwrite";
  }) => Promise<PermissionState>;
  requestPermission: (descriptor: {
    mode: "readwrite";
  }) => Promise<PermissionState>;
};
const state: { files: ImageFile[] } = { files: [] };
const $ = <T extends Element>(selector: string) =>
  document.querySelector<T>(selector)!;
const dropZone = $<HTMLDivElement>("#drop-zone"),
  fileInput = $<HTMLInputElement>("#file-input"),
  chooseButton = $<HTMLButtonElement>("#choose-button"),
  queue = $<HTMLDivElement>("#queue"),
  queueHeader = $<HTMLDivElement>("#queue-header"),
  queueCount = $<HTMLParagraphElement>("#queue-count"),
  actions = $<HTMLDivElement>("#actions"),
  splitButton = $<HTMLButtonElement>("#split-button"),
  clearButton = $<HTMLButtonElement>("#clear-button"),
  folderButton = $<HTMLButtonElement>("#folder-button"),
  locationName = $<HTMLParagraphElement>("#location-name"),
  messageStatus = $<HTMLParagraphElement>("#status");
const directoryPicker = (
  window as Window & {
    showDirectoryPicker?: () => Promise<DirectoryHandle>;
  }
).showDirectoryPicker;
let downloadDirectory: DirectoryHandle | null = null;
chooseButton.addEventListener("click", (e) => {
  e.stopPropagation();
  fileInput.click();
});
dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener("change", () => addFiles(fileInput.files));
["dragenter", "dragover"].forEach((n) =>
  dropZone.addEventListener(n, (e) => {
    e.preventDefault();
    dropZone.classList.add("is-dragging");
  }),
);
["dragleave", "drop"].forEach((n) =>
  dropZone.addEventListener(n, (e) => {
    e.preventDefault();
    dropZone.classList.remove("is-dragging");
  }),
);
dropZone.addEventListener("drop", (e) =>
  addFiles((e as DragEvent).dataTransfer?.files ?? null),
);
clearButton.addEventListener("click", () => {
  state.files = [];
  render();
  setStatus("");
});
splitButton.addEventListener("click", () => {
  void splitAll();
});
folderButton.addEventListener("click", () => {
  void chooseDownloadFolder();
});
void restoreDownloadFolder();

async function chooseDownloadFolder(): Promise<void> {
  if (!directoryPicker) {
    setStatus("Folder selection is not supported in this browser.");
    return;
  }
  try {
    downloadDirectory = await directoryPicker();
    await saveDownloadFolder(downloadDirectory);
    locationName.textContent = "Saved folder: " + downloadDirectory.name;
    setStatus("Download folder saved.");
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    setStatus("Could not save that folder.");
  }
}

async function restoreDownloadFolder(): Promise<void> {
  if (!directoryPicker) {
    folderButton.hidden = true;
    return;
  }
  const savedFolder = await readDownloadFolder();
  if (!savedFolder) return;
  downloadDirectory = savedFolder;
  locationName.textContent = "Saved folder: " + savedFolder.name;
}

function openSettingsDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("ratio-settings", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("settings");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveDownloadFolder(folder: DirectoryHandle): Promise<void> {
  const database = await openSettingsDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction("settings", "readwrite");
    transaction.objectStore("settings").put(folder, "downloadFolder");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

async function readDownloadFolder(): Promise<DirectoryHandle | null> {
  try {
    const database = await openSettingsDatabase();
    const folder = await new Promise<DirectoryHandle | undefined>(
      (resolve, reject) => {
        const request = database
          .transaction("settings", "readonly")
          .objectStore("settings")
          .get("downloadFolder");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      },
    );
    database.close();
    return folder ?? null;
  } catch {
    return null;
  }
}

async function confirmFolderPermission(): Promise<boolean> {
  if (!downloadDirectory) return false;
  const permission = await downloadDirectory.queryPermission({
    mode: "readwrite",
  });
  if (permission === "granted") return true;
  return (
    (await downloadDirectory.requestPermission({ mode: "readwrite" })) ===
    "granted"
  );
}
function addFiles(list: FileList | null): void {
  if (!list) return;
  const incoming = Array.from(list).filter((f) => f.type.startsWith("image/"));
  const existing = new Set(
    state.files.map((f) => f.name + "-" + f.size + "-" + f.lastModified),
  );
  state.files.push(
    ...incoming.filter(
      (f) => !existing.has(f.name + "-" + f.size + "-" + f.lastModified),
    ),
  );
  fileInput.value = "";
  render();
  if (!incoming.length && list.length)
    setStatus("Please choose image files only.");
}
function render(): void {
  queue.replaceChildren();
  state.files.forEach((file, index) => {
    const card = document.createElement("article");
    card.className = "image-card";
    const image = document.createElement("img");
    image.className = "thumb";
    image.alt = "Preview of " + file.name;
    image.src = URL.createObjectURL(file);
    const remove = document.createElement("button");
    remove.className = "remove-button";
    remove.type = "button";
    remove.setAttribute("aria-label", "Remove " + file.name);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      state.files.splice(index, 1);
      render();
    });
    const details = document.createElement("div");
    details.className = "card-details";
    details.innerHTML =
      '<p class="file-name" title="' +
      escapeHtml(file.name) +
      '">' +
      escapeHtml(file.name) +
      '</p><p class="file-size">' +
      formatBytes(file.size) +
      "</p>";
    card.append(image, remove, details);
    queue.append(card);
  });
  const hasFiles = state.files.length > 0;
  queueHeader.hidden = !hasFiles;
  actions.hidden = !hasFiles;
  queueCount.textContent =
    state.files.length + " " + (state.files.length === 1 ? "image" : "images");
}
async function splitAll(): Promise<void> {
  if (!state.files.length) return;
  splitButton.disabled = true;
  setStatus("Preparing your downloads…");
  let completed = 0;
  try {
    for (const file of state.files) {
      const image = await loadImage(file),
        midpoint = Math.ceil(image.naturalWidth / 2);
      const left = await cropImage(
        image,
        0,
        0,
        midpoint,
        image.naturalHeight,
        file.type,
      );
      const right = await cropImage(
        image,
        midpoint,
        0,
        image.naturalWidth - midpoint,
        image.naturalHeight,
        file.type,
      );
      await saveImage(
        left,
        baseName(file.name) + " - left." + extension(file.name),
      );
      await pause(120);
      await saveImage(
        right,
        baseName(file.name) + " - right." + extension(file.name),
      );
      completed++;
    }
    setStatus("Done — downloaded " + completed * 2 + " files.");
  } catch (error) {
    setStatus(
      "Could not split an image: " +
        (error instanceof Error ? error.message : "unknown error"),
    );
  } finally {
    splitButton.disabled = false;
  }
}
function loadImage(file: ImageFile): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image(),
      url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('"' + file.name + '" is not readable'));
    };
    image.src = url;
  });
}
function cropImage(
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  type: string,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas
      .getContext("2d")
      ?.drawImage(image, x, y, width, height, 0, 0, width, height);
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("canvas export failed")),
      type || "image/png",
    );
  });
}
async function saveImage(blob: Blob, name: string): Promise<void> {
  if (downloadDirectory && (await confirmFolderPermission())) {
    const file = await downloadDirectory.getFileHandle(name, { create: true });
    const writable = await file.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }
  downloadToBrowser(blob, name);
}

function downloadToBrowser(blob: Blob, name: string): void {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
function baseName(name: string): string {
  return name.replace(/\.[^/.]+$/, "");
}
function extension(name: string): string {
  return name.includes(".") ? name.split(".").pop()!.toLowerCase() : "png";
}
function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"],
    index = Math.min(
      Math.floor(Math.log(bytes) / Math.log(1024)),
      units.length - 1,
    );
  return (bytes / 1024 ** index).toFixed(index ? 1 : 0) + " " + units[index];
}
function setStatus(message: string): void {
  messageStatus.textContent = message;
}
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        character
      ] ?? character,
  );
}
