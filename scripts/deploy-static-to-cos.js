const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const COS = require("cos-nodejs-sdk-v5");

const root = path.resolve(__dirname, "..");
const sourceDirectory = path.join(root, "dist");
const bucket = process.env.COS_BUCKET || "mrcatenglish-web-1441914554";
const region = process.env.COS_REGION || "ap-shanghai";
const concurrency = 4;
const maximumUploadAttempts = 5;
const maximumMultipartFileAttempts = 2;
const multipartThreshold = 5 * 1024 * 1024;
const multipartChunkSize = 1024 * 1024;

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

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRetryableUploadError(error) {
  return new Set([
    "ConnectionReset",
    "ECONNRESET",
    "ETIMEDOUT",
    "RequestTimeout",
    "SlowDown",
    "UserNetworkTooSlow",
  ]).has(error?.code);
}

async function uploadFile(file) {
  const attempts =
    file.size >= multipartThreshold
      ? maximumMultipartFileAttempts
      : maximumUploadAttempts;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const commonParameters = {
        Bucket: bucket,
        Region: region,
        Key: file.key,
        ContentType: contentTypeFor(file.key),
        CacheControl: file.key.endsWith(".html")
          ? "no-cache"
          : "public, max-age=3600",
      };
      if (file.size >= multipartThreshold) {
        await uploadMultipartFile(file, commonParameters);
      } else {
        await cosRequest("putObject", {
          ...commonParameters,
          Body: fs.createReadStream(file.absolutePath),
          ContentLength: file.size,
        });
      }
      return;
    } catch (error) {
      if (!isRetryableUploadError(error) || attempt === attempts) {
        throw error;
      }
      console.warn(
        `Retrying ${file.key} after ${error.code} ` +
          `(attempt ${attempt + 1}/${attempts}).`
      );
      await delay(1000 * attempt * attempt);
    }
  }
}

async function uploadPartWithRetry(parameters, fileKey, partNumber) {
  for (let attempt = 1; attempt <= maximumUploadAttempts; attempt += 1) {
    try {
      return await cosRequest("multipartUpload", parameters);
    } catch (error) {
      if (!isRetryableUploadError(error) || attempt === maximumUploadAttempts) {
        throw error;
      }
      console.warn(
        `Retrying ${fileKey} part ${partNumber} after ${error.code} ` +
          `(attempt ${attempt + 1}/${maximumUploadAttempts}).`
      );
      await delay(1000 * attempt * attempt);
    }
  }
}

async function uploadMultipartFile(file, commonParameters) {
  const initialized = await cosRequest("multipartInit", commonParameters);
  const uploadId = initialized.UploadId;
  const parts = [];

  try {
    for (
      let offset = 0, partNumber = 1;
      offset < file.size;
      offset += multipartChunkSize, partNumber += 1
    ) {
      const end = Math.min(offset + multipartChunkSize, file.size);
      const result = await uploadPartWithRetry(
        {
          Bucket: bucket,
          Region: region,
          Key: file.key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: fs.createReadStream(file.absolutePath, {
            start: offset,
            end: end - 1,
          }),
          ContentLength: end - offset,
        },
        file.key,
        partNumber
      );
      parts.push({ PartNumber: partNumber, ETag: result.ETag });
    }

    await cosRequest("multipartComplete", {
      Bucket: bucket,
      Region: region,
      Key: file.key,
      UploadId: uploadId,
      Parts: parts,
    });
  } catch (error) {
    await cosRequest("multipartAbort", {
      Bucket: bucket,
      Region: region,
      Key: file.key,
      UploadId: uploadId,
    }).catch(() => {});
    throw error;
  }
}

function etagForBuffer(buffer) {
  if (buffer.length < multipartThreshold) {
    return crypto.createHash("md5").update(buffer).digest("hex");
  }
  const partHashes = [];
  for (let offset = 0; offset < buffer.length; offset += multipartChunkSize) {
    partHashes.push(
      crypto
        .createHash("md5")
        .update(buffer.subarray(offset, offset + multipartChunkSize))
        .digest()
    );
  }
  return (
    crypto.createHash("md5").update(Buffer.concat(partHashes)).digest("hex") +
    `-${partHashes.length}`
  );
}

function listLocalFiles(directory, relativeDirectory = "") {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listLocalFiles(absolutePath, relativePath));
    } else if (entry.isFile()) {
      const contents = fs.readFileSync(absolutePath);
      files.push({
        absolutePath,
        key: relativePath,
        size: fs.statSync(absolutePath).size,
        etag: etagForBuffer(contents),
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
        size: Number(object.Size),
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
  const remoteObjectsByKey = new Map(
    remoteObjects.map((object) => [object.key, object])
  );
  const filesToUpload = files
    .filter((file) => {
      const remoteObject = remoteObjectsByKey.get(file.key);
      if (!remoteObject) {
        return true;
      }
      // COS does not expose an S3-compatible multipart ETag here. Large
      // immutable media files therefore use the object size as the stable
      // incremental-deploy comparison instead of being reuploaded every run.
      if (file.size >= multipartThreshold) {
        return remoteObject.size !== file.size;
      }
      return remoteObject.etag !== file.etag;
    })
    .sort((left, right) => left.size - right.size || left.key.localeCompare(right.key));
  let uploaded = 0;
  const failedUploads = [];

  console.log(
    `Deploying ${files.length} public files to cos://${bucket}/: ` +
      `${filesToUpload.length} changed, ${files.length - filesToUpload.length} unchanged.`
  );
  const multipartFiles = filesToUpload.filter(
    (file) => file.size >= multipartThreshold
  ).length;
  if (multipartFiles > 0) {
    console.log(
      `Using ${multipartChunkSize / 1024 / 1024} MB multipart chunks for ` +
        `${multipartFiles} files of at least ${multipartThreshold / 1024 / 1024} MB.`
    );
  }
  await runConcurrent(filesToUpload, async (file) => {
    try {
      await uploadFile(file);
      uploaded += 1;
      if (
        uploaded % 100 === 0 ||
        file.size >= multipartThreshold ||
        uploaded === filesToUpload.length
      ) {
        console.log(`Uploaded ${uploaded}/${filesToUpload.length}: ${file.key}`);
      }
    } catch (error) {
      failedUploads.push({ file, error });
      console.error(
        `Skipping ${file.key} after upload retries: ${error?.code || error?.message || error}`
      );
    }
  });

  if (failedUploads.length > 0) {
    const sample = failedUploads
      .slice(0, 10)
      .map(({ file, error }) => `${file.key} (${error?.code || "unknown error"})`)
      .join(", ");
    throw new Error(
      `${failedUploads.length} file(s) could not be uploaded; rerun to retry only ` +
        `the remaining files. First failures: ${sample}`
    );
  }

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
