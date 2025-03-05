"use client";

import { useState } from "react";

export default function FileUpload() {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const uploadFile = async () => {
    if (!file) return alert("Please select a file!");

    const formData = new FormData();
    formData.append("file", file);

    setUploading(true);
    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });

    setUploading(false);
    if (response.ok) {
      alert("Upload successful!");
    } else {
      alert("Upload failed!");
    }
  };

  return (
    <div className="p-4 border rounded-lg">
      <input type="file" onChange={handleFileChange} className="mb-2" />
      <button
        onClick={uploadFile}
        className="bg-blue-500 text-white px-4 py-2 rounded"
        disabled={uploading}
      >
        {uploading ? "Uploading..." : "Upload"}
      </button>
    </div>
  );
}
