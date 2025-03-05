import FileUpload from "@/components/FileUpload";

export default function Home() {
  return (
    <div className="p-10">
      <h1 className="text-2xl font-bold">CV Parser</h1>
      <FileUpload />
    </div>
  );
}
