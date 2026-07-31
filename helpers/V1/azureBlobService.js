import { BlobServiceClient, StorageSharedKeyCredential } from "@azure/storage-blob";

// Mirrors skillsconnect-node's Helpers/Website/V1/providers/azureBlobService.azure.js —
// same account, same connection-string-placeholder handling, same container-per-
// environment convention (skillsconnect-stage locally, skillsconnect on live).
// Kept as a separate copy rather than a shared package since crm-backend and
// skillsconnect-node are independent deployables.

const AZURE_ACCOUNT_NAME = String(process.env.AZURE_ACCOUNT_NAME || "skillsconnect").trim().replace(/^['"]|['"]$/g, "");
const AZURE_ACCOUNT_KEY = String(process.env.AZURE_ACCOUNT_KEY || "").trim().replace(/^['"]|['"]$/g, "");
const RAW_AZURE_CONNECTION_STRING = String(process.env.AZURE_STORAGE_CONNECTION_STRING || "").trim();
const HAS_PLACEHOLDER_CONNECTION_STRING = /\$\{[^}]+\}/.test(RAW_AZURE_CONNECTION_STRING);
const AZURE_STORAGE_CONNECTION_STRING =
  RAW_AZURE_CONNECTION_STRING && !HAS_PLACEHOLDER_CONNECTION_STRING
    ? RAW_AZURE_CONNECTION_STRING
    : `DefaultEndpointsProtocol=https;AccountName=${AZURE_ACCOUNT_NAME};AccountKey=${AZURE_ACCOUNT_KEY};EndpointSuffix=core.windows.net`;

// CONTAINER_NAME is expected to be set explicitly per environment (skillsconnect-stage
// in this repo's local .env); the ENVIRONMENT fallback is just a safety net matching
// the same convention used in config/knex.js.
const CONTAINER_NAME =
  process.env.CONTAINER_NAME || (process.env.ENVIRONMENT === "PRODUCTION" ? "skillsconnect" : "skillsconnect-stage");

const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_STORAGE_CONNECTION_STRING);
const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

export const uploadToAzureBlob = async (fileName, buffer, mimeType, directory = "crm") => {
  if (!AZURE_ACCOUNT_KEY) {
    console.error("Error in uploadToAzureBlob: Missing AZURE_ACCOUNT_KEY in environment.");
    return null;
  }

  const blobPath = directory ? `${directory}/${fileName}` : fileName;

  try {
    const blockBlobClient = containerClient.getBlockBlobClient(blobPath);
    await blockBlobClient.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: mimeType },
    });
    return blockBlobClient.url;
  } catch (error) {
    console.error("Error in uploadToAzureBlob:", error.message);
    return null;
  }
};

/**
 * Downloads a blob's content as a Node Readable stream, given its full URL
 * (any container). Used by authenticated download/stream routes that proxy
 * the file rather than exposing the raw blob URL to the browser.
 */
export const getAzureBlobStream = async (blobUrl) => {
  const parsed = new URL(blobUrl);
  const pathParts = parsed.pathname.split("/").filter(Boolean);
  if (pathParts.length < 2) throw new Error("Malformed blob URL");

  const container = decodeURIComponent(pathParts[0]);
  const blobPath = pathParts.slice(1).map(decodeURIComponent).join("/");

  const sharedKeyCredential = new StorageSharedKeyCredential(AZURE_ACCOUNT_NAME, AZURE_ACCOUNT_KEY);
  const client = new BlobServiceClient(`https://${AZURE_ACCOUNT_NAME}.blob.core.windows.net`, sharedKeyCredential);
  const blockBlobClient = client.getContainerClient(container).getBlockBlobClient(blobPath);

  const download = await blockBlobClient.download();
  return { stream: download.readableStreamBody, contentType: download.contentType, contentLength: download.contentLength };
};

export const deleteBlobByUrl = async (blobUrl) => {
  try {
    if (!blobUrl) return { status: false, error: "Missing blobUrl" };

    const parsed = new URL(blobUrl);
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    if (pathParts.length < 2) return { status: false, error: "Malformed blob URL" };

    const container = decodeURIComponent(pathParts[0]);
    const blobPath = pathParts.slice(1).map(decodeURIComponent).join("/");

    const sharedKeyCredential = new StorageSharedKeyCredential(AZURE_ACCOUNT_NAME, AZURE_ACCOUNT_KEY);
    const client = new BlobServiceClient(`https://${AZURE_ACCOUNT_NAME}.blob.core.windows.net`, sharedKeyCredential);
    const blockBlobClient = client.getContainerClient(container).getBlockBlobClient(blobPath);

    await blockBlobClient.deleteIfExists();
    return { status: true };
  } catch (error) {
    console.error("deleteBlobByUrl failed:", error.message);
    return { status: false, error: error.message };
  }
};

export default { uploadToAzureBlob, getAzureBlobStream, deleteBlobByUrl };
