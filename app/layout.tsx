import "./globals.css";
export const metadata = {
  title: "Turno · Gestão de agendamentos",
  description: "Agenda online do seu negócio.",
  appleWebApp:{capable:true,title:"Turno",statusBarStyle:"default"},
  icons:{icon:"/turno-icon.png",apple:"/turno-icon.png"},
};
export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
