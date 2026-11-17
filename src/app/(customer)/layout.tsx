import { Footer } from "@/components/footer";
import { Header } from "@/components/header";

/** The customer site: restaurant header, content column and footer. */
export default function CustomerLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <Header />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-6 sm:pb-12">
        {children}
      </main>
      <Footer />
    </>
  );
}
