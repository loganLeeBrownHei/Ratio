# Ratio — Image Splitter

A dependency-light TypeScript app that splits images down the vertical center and downloads the two halves.

## Run locally

Install dependencies, then run npm start. The TypeScript source is app.ts and compiles to app.js.

Drop in one or more images, then select Split & download. Browser download settings determine the exact Downloads folder location.

In supported browsers, use **Choose folder** to grant Ratio access to a folder. The approved folder handle is stored locally in IndexedDB and reused on future visits. If folder access is unavailable or permission is revoked, downloads fall back to the browser's normal Downloads folder.

# Ratio
