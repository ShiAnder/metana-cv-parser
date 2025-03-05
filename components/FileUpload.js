"use client";

import { useState } from "react";

export default function FileUpload() {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
    setError(null);
  };

  const uploadFile = async () => {
    if (!file) {
      setError("Please select a file!");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    try {
      setUploading(true);
      setError(null);

      const response = await fetch("/api/upload", {
        method: "POST",
        headers: {
          // Don't set Content-Type header, let the browser set it with the boundary
          'Accept': 'application/json',
        },
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Upload failed');
      }

      alert("Upload successful!");
      setFile(null);
    } catch (error) {
      console.error('Upload error:', error);
      setError(error.message || "Upload failed!");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="p-4 border rounded-lg">
      <input 
        type="file" 
        onChange={handleFileChange} 
        className="mb-2"
        accept=".pdf,.docx"
      />
      {error && (
        <div className="text-red-500 mb-2">{error}</div>
      )}
      <button
        onClick={uploadFile}
        className="bg-blue-500 text-white px-4 py-2 rounded disabled:opacity-50"
        disabled={uploading || !file}
      >
        {uploading ? "Uploading..." : "Upload"}
      </button>
    </div>
  );
}
