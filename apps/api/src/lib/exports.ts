import PDFDocument from "pdfkit";
import type { Artifact, Session, Turn } from "../store/types.js";

const formatTimestamp = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toISOString();
};

export const buildSessionMarkdown = (
  session: Session,
  turns: Turn[],
  artifacts: Artifact[]
) => {
  const lines: string[] = [];
  lines.push(`# ${session.title ?? "Untitled Council"}`);
  lines.push("");
  lines.push(`Mode: ${session.mode ?? "Unspecified"}`);
  lines.push(`Status: ${session.status}`);
  lines.push(`Created: ${formatTimestamp(session.createdAt)}`);
  lines.push("");

  if (artifacts.length > 0) {
    lines.push("## Artifacts");
    for (const artifact of artifacts) {
      lines.push(
        `- ${artifact.filename} (${artifact.mime}, ${artifact.status})`
      );
    }
    lines.push("");
  }

  lines.push("## Transcript");
  for (const turn of turns) {
    lines.push(`### ${turn.persona}`);
    lines.push(`_Time: ${formatTimestamp(turn.createdAt)}_`);
    lines.push("");
    lines.push(turn.content);
    lines.push("");
  }

  return lines.join("\n");
};

export const renderPdfBuffer = (title: string, markdown: string) =>
  new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 48 });
      const chunks: Buffer[] = [];

      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));

      doc.fontSize(18).text(title, { underline: true });
      doc.moveDown();
      doc.fontSize(11).text(markdown, { lineGap: 4 });
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
