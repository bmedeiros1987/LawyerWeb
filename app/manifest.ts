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
    name: "MBLZ Legal OS",
    short_name: "MBLZ",
    description: "Operação jurídica, prazos, documentos e inteligência.",
    start_url: "/app",
    display: "standalone",
    background_color: "#f5f6f8",
    theme_color: "#11141d",
    lang: "pt-BR",
    icons: [{ src: "/brand/mblz-app-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" }],
    share_target: {
      action: "/api/intake/share-target",
      method: "POST",
      enctype: "multipart/form-data",
      params: { title: "title", text: "text", url: "url" },
    },
  };
}
