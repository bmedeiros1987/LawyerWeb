import "./globals.css";
import { PwaRegister } from "@/components/pwa-register";

export const metadata={
  title:{default:"LawyerMind — Gestão jurídica",template:"%s · LawyerMind"},
  description:"Operação jurídica, prazos, documentos e inteligência em um único sistema.",
  appleWebApp:{capable:true,statusBarStyle:"black-translucent",title:"LawyerMind"},
  applicationName:"LawyerMind",
};

export default function RootLayout({children}:{children:React.ReactNode}){
  return <html lang="pt-BR"><body><PwaRegister/>{children}</body></html>
}
