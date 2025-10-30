import type { Env } from "../env";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // https://pub-979cb28270cc461d94bc8a169d8f389d.r2.dev/somatosensory.pdf
    const pdf = await env.R2.get("somatosensory.pdf");

    // https://pub-979cb28270cc461d94bc8a169d8f389d.r2.dev/cat.jpeg
    const cat = await env.R2.get("cat.jpeg");

    return Response.json(
      await env.AI.toMarkdown([
        {
          name: "somatosensory.pdf",
          blob: new Blob([await pdf.arrayBuffer()], {
            type: "application/octet-stream",
          }),
        },
        {
          name: "cat.jpeg",
          blob: new Blob([await cat.arrayBuffer()], {
            type: "application/octet-stream",
          }),
        },
      ]),
    );
  },
};
