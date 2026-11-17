"use strict";
const state = { files: [] };
const $ = (selector) => document.querySelector(selector);
const dropZone = $("#drop-zone"),
  fileInput = $("#file-input"),
  chooseButton = $("#choose-button"),
  queue = $("#queue"),
  queueHeader = $("#queue-header"),
  queueCount = $("#queue-count"),
  actions = $("#actions"),
  splitButton = $("#split-button"),
  clearButton = $("#clear-button"),
  folderButton = $("#folder-button"),
  locationName = $("#location-name"),
  messageStatus = $("#status");
const directoryPicker = window.showDirectoryPicker;
let downloadDirectory = null;
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
  addFiles(e.dataTransfer?.files ?? null),
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
async function chooseDownloadFolder() {
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
async function restoreDownloadFolder() {
  if (!directoryPicker) {
    folderButton.hidden = true;
    return;
  }
  const savedFolder = await readDownloadFolder();
  if (!savedFolder) return;
  downloadDirectory = savedFolder;
  locationName.textContent = "Saved folder: " + savedFolder.name;
}
function openSettingsDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("ratio-settings", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("settings");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function saveDownloadFolder(folder) {
  const database = await openSettingsDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction("settings", "readwrite");
    transaction.objectStore("settings").put(folder, "downloadFolder");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}
async function readDownloadFolder() {
  try {
    const database = await openSettingsDatabase();
    const folder = await new Promise((resolve, reject) => {
      const request = database
        .transaction("settings", "readonly")
        .objectStore("settings")
        .get("downloadFolder");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return folder ?? null;
  } catch {
    return null;
  }
}
async function confirmFolderPermission() {
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
function addFiles(list) {
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
function render() {
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
async function splitAll() {
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
function loadImage(file) {
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
function cropImage(image, x, y, width, height, type) {
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
async function saveImage(blob, name) {
  if (downloadDirectory && (await confirmFolderPermission())) {
    const file = await downloadDirectory.getFileHandle(name, { create: true });
    const writable = await file.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }
  downloadToBrowser(blob, name);
}
function downloadToBrowser(blob, name) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
function baseName(name) {
  return name.replace(/\.[^/.]+$/, "");
}
function extension(name) {
  return name.includes(".") ? name.split(".").pop().toLowerCase() : "png";
}
function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"],
    index = Math.min(
      Math.floor(Math.log(bytes) / Math.log(1024)),
      units.length - 1,
    );
  return (bytes / 1024 ** index).toFixed(index ? 1 : 0) + " " + units[index];
}
function setStatus(message) {
  messageStatus.textContent = message;
}
function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function escapeHtml(value) {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        character
      ] ?? character,
  );
}
