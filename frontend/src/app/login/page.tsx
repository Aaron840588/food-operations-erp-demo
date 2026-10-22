import Image from "next/image";

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-[#f4eee3] px-6 py-16 text-[#2d1f0e]">
      <section className="w-full max-w-lg" aria-labelledby="demo-heading">
        <Image src="/hh-logo.png" alt="H+H Hub" width={72} height={72} className="mb-8 rounded-xl" />
        <p className="text-sm font-semibold mb-3">H+H Hub / Portfolio project</p>
        <h1 id="demo-heading" className="text-4xl font-heading font-bold leading-tight">The interactive demo is under maintenance.</h1>
        <p className="mt-6 text-base leading-relaxed">The hosted service is currently unavailable. You can still review the project workflows, screenshots, implementation and known limits in the case study.</p>
        <div className="mt-8 flex flex-wrap gap-5 items-center">
          <a href="https://aarontagapan.vercel.app/work/hh-hub" className="inline-flex min-h-12 items-center px-5 py-3 bg-[#885625] text-white rounded-lg font-semibold focus-visible:outline-2 focus-visible:outline-offset-4">Read the case study</a>
          <a href="https://github.com/Aaron840588/food-operations-erp-demo" className="inline-flex min-h-12 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">Review source code</a>
        </div>
        <p className="mt-10 text-sm leading-relaxed">No registration or credentials are needed to review the portfolio. Demo access will return after backend connectivity and authenticated guest access have been verified.</p>
      </section>
    </main>
  );
}
