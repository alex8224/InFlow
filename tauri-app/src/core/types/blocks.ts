export type ContentBlock =
  | { type: "markdown"; markdown: string }
  | { type: "code"; language?: string; code: string }
  | { type: "mermaid"; code: string }
  | { type: "diff"; before: string; after: string; format?: "unified" | "split" }
  | { type: "citations"; citations: { docId: string; snippet?: string; location?: any }[] }
  | { type: "artifact"; artifactId: string; title: string; kind: string; content: string };
