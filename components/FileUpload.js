"use client";

import { useState } from "react";

export default function FileUpload() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
  });
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    setError(null);
    setSuccess(false);
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      if (selectedFile.size > 10 * 1024 * 1024) {
        setError("File size must be less than 10MB");
        setFile(null);
        return;
      }
      const allowedTypes = [
        'application/pdf', 
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ];
      if (!allowedTypes.includes(selectedFile.type)) {
        setError(`Unsupported file type: ${selectedFile.type}. Please upload only PDF or DOCX files`);
        setFile(null);
        return;
      }
      console.log('Selected file type:', selectedFile.type);
    }
    setFile(selectedFile);
    setError(null);
    setSuccess(false);
  };

  const uploadFile = async (e) => {
    e.preventDefault(); // Prevent the default form submission behavior

    if (!file) {
      setError("Please select a file!");
      return;
    }

    console.log('Uploading file:', {
      name: file.name,
      type: file.type,
      size: file.size,
    });

    const form = new FormData();
    form.append("file", file, file.name);
    form.append("filename", file.name);
    Object.entries(formData).forEach(([key, value]) => {
      form.append(key, value);
    });

    try {
      setUploading(true);
      setError(null);
      setSuccess(false);

      const response = await fetch("/api/upload", {
        method: "POST",
        body: form,
      });

      const data = await response.json();
      
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || data?.message || 'Upload failed');
      }

      setSuccess(true);
      setFile(null);
      setFormData({ name: '', email: '', phone: '' });
    } catch (error) {
      console.error('Upload error:', error);
      setError(error.message || "Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto bg-white p-6 rounded-xl shadow-md">
      <form onSubmit={uploadFile} className="space-y-4">
        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded relative" role="alert">
            <strong className="font-bold">Success!</strong>
            <span className="block sm:inline"> Your CV has been uploaded successfully.</span>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded relative" role="alert">
            <strong className="font-bold">Error!</strong>
            <span className="block sm:inline"> {error}</span>
          </div>
        )}

        {/* Name Field */}
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700">
            Name
          </label>
          <input
            type="text"
            id="name"
            name="name"
            value={formData.name}
            onChange={handleInputChange}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-gray-900 placeholder-gray-500"
            placeholder="Enter your name"
          />
        </div>

        {/* Email Field */}
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700">
            Email
          </label>
          <input
            type="email"
            id="email"
            name="email"
            value={formData.email}
            onChange={handleInputChange}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-gray-900 placeholder-gray-500"
            placeholder="Enter your email"
          />
        </div>

        {/* Phone Field */}
        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-gray-700">
            Phone
          </label>
          <input
            type="tel"
            id="phone"
            name="phone"
            value={formData.phone}
            onChange={handleInputChange}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-gray-900 placeholder-gray-500"
            placeholder="Enter your phone number"
          />
        </div>

        {/* File Upload */}
        <div>
          <label htmlFor="file" className="block text-sm font-medium text-gray-700">
            Upload CV (Required)
          </label>
          <div className="mt-1 flex items-center">
            <label
              htmlFor="file"
              className="cursor-pointer px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              Select File
            </label>
            <input
              id="file"
              type="file"
              name="file"
              accept=".pdf,.docx"
              onChange={handleFileChange}
              className="sr-only"
            />
            <span className="ml-3 text-sm text-gray-500">
              Only PDF and DOCX files are supported
            </span>
          </div>
          {file && (
            <p className="mt-2 text-sm text-gray-500">Selected file: {file.name}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={uploading}
          className="w-full inline-flex justify-center items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
        >
          {uploading ? 'Uploading...' : 'Upload CV'}
        </button>
      </form>
    </div>

  );
}
