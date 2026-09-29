import { auth } from "@/auth"; import { redirect } from "next/navigation";
export const dynamic="force-dynamic";
export default async function Home(){const session=await auth();redirect(session?.user?"/app":"/login")}