import pdfParse from "pdf-parse";

const DEFAULT_LIMIT = 12000;

export const limitText = (value: string, limit = DEFAULT_LIMIT) =>
  value.length > limit ? value.slice(0, limit) : value;

export const parseArtifactBuffer = async (buffer: Buffer, mime: string) => {
  if (mime === "application/pdf") {
    const result = await pdfParse(buffer);
    return result.text ?? "";
  }

  if (mime.startsWith("text/")) {
    return buffer.toString("utf8");
  }

  return "";
};
