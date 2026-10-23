import FictionalDemo from "@/components/FictionalDemo";
import "./demo.css";
export default function DemoPage() {
  return (
    <>
      <noscript>
        <p style={{ padding: "20px", background: "#fff1cb", color: "#302b24" }}>
          Enable JavaScript to use the interactive sample. You can also{" "}
          <a href="https://aarontagapan.vercel.app/work/hh-hub">
            read the case study
          </a>
          .
        </p>
      </noscript>
      <FictionalDemo />
    </>
  );
}
