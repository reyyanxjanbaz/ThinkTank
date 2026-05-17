import pdfParse from "pdf-parse";

const DEFAULT_LIMIT = 12000;
const PDF_SIGNATURE = "%PDF-";

export type ArtifactKind = "pdf" | "text";

const normalizeMime = (value: string) => value.trim().toLowerCase();

const hasPdfExtension = (filename: string) =>
  filename.trim().toLowerCase().endsWith(".pdf");

const hasTextExtension = (filename: string) => {
  const normalized = filename.trim().toLowerCase();
  return normalized.endsWith(".txt") || normalized.endsWith(".md");
};

const hasPdfSignature = (buffer: Buffer) =>
  buffer.length >= PDF_SIGNATURE.length &&
  buffer.subarray(0, PDF_SIGNATURE.length).toString("ascii") === PDF_SIGNATURE;

const isPdfMime = (mime: string) => {
  const normalized = normalizeMime(mime);
  return (
    normalized === "application/pdf" ||
    normalized === "application/x-pdf" ||
    normalized === "application/acrobat"
  );
};

const isTextMime = (mime: string) => normalizeMime(mime).startsWith("text/");

export const limitText = (value: string, limit = DEFAULT_LIMIT) =>
  value.length > limit ? value.slice(0, limit) : value;

export const detectArtifactKind = (
  buffer: Buffer,
  mime: string,
  filename: string
): ArtifactKind | null => {
  if (hasPdfSignature(buffer) || isPdfMime(mime) || hasPdfExtension(filename)) {
    return "pdf";
  }

  if (isTextMime(mime) || hasTextExtension(filename)) {
    return "text";
  }

  return null;
};

export const parseArtifactBuffer = async (
  buffer: Buffer,
  mime: string,
  filename: string
) => {
  const kind = detectArtifactKind(buffer, mime, filename);
  if (kind === "pdf") {
    const result = await pdfParse(buffer);
    return result.text ?? "";
  }

  if (kind === "text") {
    return buffer.toString("utf8");
  }

  return "";
};
