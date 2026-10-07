import type { MetadataRoute } from "next";

type MBLZManifest = MetadataRoute.Manifest & {
  share_target?: {
    action: string;
    method: "POST";
    enctype: "multipart/form-data";
    params: { title: string; text: string; url: string };
  };
};

export default function manifest(): MBLZManifest {
  return {
    name: "LawyerMind",
    short_name: "LawyerMind",
    description: "Operação jurídica, prazos, documentos e inteligência.",
    start_url: "/app",
    display: "standalone",
    background_color: "#f5f6f8",
    theme_color: "#11141d",
    lang: "pt-BR",
    icons: [{ src: "/brand/lawyermind-app-icon.png", sizes: "1024x1024", type: "image/png", purpose: "any" }],
    share_target: {
      action: "/api/intake/share-target",
      method: "POST",
      enctype: "multipart/form-data",
      params: { title: "title", text: "text", url: "url" },
    },
  };
}
