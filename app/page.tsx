import FileUpload from "@/components/FileUpload";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-10 bg-gray-100">
      <h1 className="text-4xl font-bold mb-8 text-center text-transparent bg-clip-text bg-gradient-to-r from-blue-500 to-purple-600 shadow-2xl">
        Metana CV PARSER
      </h1>
      <FileUpload />
    </div>
  );
}
