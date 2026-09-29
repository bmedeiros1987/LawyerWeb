import "./globals.css";
import { PwaRegister } from "@/components/pwa-register";

export const metadata={
  title:{default:"MBLZ — Legal Operating System",template:"%s · MBLZ"},
  description:"Operação jurídica, prazos, documentos e inteligência em um único sistema.",
  appleWebApp:{capable:true,statusBarStyle:"black-translucent",title:"MBLZ"},
  applicationName:"MBLZ",
};

export default function RootLayout({children}:{children:React.ReactNode}){
  return <html lang="pt-BR"><body><PwaRegister/>{children}</body></html>
}
