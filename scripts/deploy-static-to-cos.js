const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const COS = require("cos-nodejs-sdk-v5");

const root = path.resolve(__dirname, "..");
const sourceDirectory = path.join(root, "dist");
const bucket = process.env.COS_BUCKET || "mrcatenglish-web-1441914554";
const region = process.env.COS_REGION || "ap-shanghai";
const concurrency = 8;

function normalizeCredential(value, name) {
  if (!value) {
    throw new Error(`Missing ${name} GitHub secret.`);
  }

  let normalized = value.trim();
  const firstCharacter = normalized[0];
  const lastCharacter = normalized[normalized.length - 1];
  if (
    normalized.length >= 2 &&
    ((firstCharacter === '"' && lastCharacter === '"') ||
      (firstCharacter === "'" && lastCharacter === "'"))
  ) {
    normalized = normalized.slice(1, -1).trim();
  }

  normalized = normalized.replace(/\s+/g, "");
  if (!normalized) {
    throw new Error(`${name} is empty after removing whitespace.`);
  }
  return normalized;
}

const secretId = normalizeCredential(
  process.env.TENCENT_CLOUD_SECRET_ID,
  "TENCENT_CLOUD_SECRET_ID"
);
const secretKey = normalizeCredential(
  process.env.TENCENT_CLOUD_SECRET_KEY,
  "TENCENT_CLOUD_SECRET_KEY"
);

if (!fs.existsSync(path.join(sourceDirectory, "index.html"))) {
  throw new Error("dist/index.html is missing. Run npm run build:static first.");
}

const cos = new COS({ SecretId: secretId, SecretKey: secretKey });

function cosRequest(method, parameters) {
  return new Promise((resolve, reject) => {
    cos[method](parameters, (error, data) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(data);
    });
  });
}

function listLocalFiles(directory, relativeDirectory = "") {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listLocalFiles(absolutePath, relativePath));
    } else if (entry.isFile()) {
      files.push({
        absolutePath,
        key: relativePath,
        size: fs.statSync(absolutePath).size,
        etag: crypto.createHash("md5").update(fs.readFileSync(absolutePath)).digest("hex"),
      });
    }
  }
  return files;
}

function contentTypeFor(key) {
  const extension = path.extname(key).toLowerCase();
  return (
    {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".ico": "image/x-icon",
      ".jpeg": "image/jpeg",
      ".jpg": "image/jpeg",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".mp3": "audio/mpeg",
      ".pdf": "application/pdf",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".webmanifest": "application/manifest+json; charset=utf-8",
      ".webp": "image/webp",
    }[extension] || "application/octet-stream"
  );
}

async function runConcurrent(items, worker) {
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      await worker(items[currentIndex], currentIndex);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, runWorker)
  );
}

async function listRemoteObjects() {
  const objects = [];
  let marker;
  do {
    const response = await cosRequest("getBucket", {
      Bucket: bucket,
      Region: region,
      ...(marker ? { Marker: marker } : {}),
    });
    for (const object of response.Contents || []) {
      objects.push({
        key: object.Key,
        etag: String(object.ETag || "").replace(/^\"|\"$/g, "").toLowerCase(),
      });
    }
    marker = response.IsTruncated === "true" ? response.NextMarker : undefined;
  } while (marker);
  return objects;
}

async function deploy() {
  const files = listLocalFiles(sourceDirectory);
  const localKeys = new Set(files.map((file) => file.key));
  const remoteObjects = await listRemoteObjects();
  const remoteEtags = new Map(
    remoteObjects.map((object) => [object.key, object.etag])
  );
  const filesToUpload = files.filter(
    (file) => remoteEtags.get(file.key) !== file.etag
  );
  let uploaded = 0;

  console.log(
    `Deploying ${files.length} public files to cos://${bucket}/: ` +
      `${filesToUpload.length} changed, ${files.length - filesToUpload.length} unchanged.`
  );
  await runConcurrent(filesToUpload, async (file) => {
    await cosRequest("putObject", {
      Bucket: bucket,
      Region: region,
      Key: file.key,
      Body: fs.createReadStream(file.absolutePath),
      ContentLength: file.size,
      ContentType: contentTypeFor(file.key),
      CacheControl: file.key.endsWith(".html")
        ? "no-cache"
        : "public, max-age=3600",
    });
    uploaded += 1;
    if (uploaded % 100 === 0 || uploaded === filesToUpload.length) {
      console.log(`Uploaded ${uploaded}/${filesToUpload.length} changed files.`);
    }
  });

  const obsoleteKeys = remoteObjects
    .map((object) => object.key)
    .filter((key) => !localKeys.has(key));
  if (obsoleteKeys.length > 0) {
    console.log(`Removing ${obsoleteKeys.length} obsolete remote files ...`);
    await runConcurrent(obsoleteKeys, (key) =>
      cosRequest("deleteObject", {
        Bucket: bucket,
        Region: region,
        Key: key,
      })
    );
  }

  console.log(
    `COS deployment complete: ${filesToUpload.length} uploaded, ` +
      `${files.length - filesToUpload.length} unchanged, ${obsoleteKeys.length} removed.`
  );
}

deploy().catch((error) => {
  const requestId =
    error?.headers?.["x-cos-request-id"] || error?.requestId || undefined;
  console.error("COS deployment failed.");
  console.error(
    JSON.stringify(
      {
        code: error?.code,
        statusCode: error?.statusCode,
        message: error?.message || String(error),
        requestId,
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
