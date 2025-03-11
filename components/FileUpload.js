"use client";

import React, { useState } from 'react';

export default function FileUpload() {
  const [file, setFile] = useState(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);
  const [formData, setFormData] = useState(null);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    setFile(selectedFile);
    console.log('Selected file type:', selectedFile?.type);
  };

  const uploadFile = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      if (!file) {
        throw new Error('Please select a file');
      }

      console.log('Uploading file:', {
        name: file.name,
        type: file.type,
        size: file.size
      });

      // Create form data
      const formData = new FormData();
      formData.append('file', file);
      formData.append('filename', file.name);
      formData.append('name', name);
      formData.append('email', email);
      formData.append('phone', phone);

      // Log FormData contents for debugging
      console.log('FormData contents:');
      for (let [key, value] of formData.entries()) {
        console.log(key, ':', typeof value === 'object' ? `${value.name} ${value.type} ${value.size}` : value);
      }

      // Determine which endpoint to use
      const uploadEndpoint = '/api/direct-upload';
      console.log('Using upload endpoint:', uploadEndpoint);

      // Log the form data again just before sending
      console.log('FormData contents:');
      for (let [key, value] of formData.entries()) {
        console.log(key, ':', typeof value === 'object' ? `${value.name} ${value.type} ${value.size}` : value);
      }

      console.log('Sending request to endpoint:', uploadEndpoint);
      const response = await fetch(uploadEndpoint, {
        method: 'POST',
        body: formData,
      });

      console.log('Response received:', {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries([...response.headers.entries()])
      });

      // Try to get response text first to see if it's even valid
      const responseText = await response.text();
      console.log('Response text length:', responseText.length);
      
      let data;
      // Try to parse as JSON if there's content
      if (responseText && responseText.trim()) {
        try {
          data = JSON.parse(responseText);
          console.log('Response data:', data);
        } catch (parseError) {
          console.error('Error parsing JSON response:', parseError);
          console.log('Raw response text:', responseText);
          throw new Error('Invalid response from server. Not valid JSON.');
        }
      } else {
        console.warn('Response was empty');
        // Create our own data object since the response was empty
        data = { 
          success: response.ok, 
          message: response.ok ? 'Request processed' : 'Server error' 
        };
      }

      if (response.ok && (data.success !== false)) {
        setSuccess(true);
        setFormData({
          name,
          email,
          phone,
          filename: file.name
        });
        
        // Reset the form on success
        setFile(null);
        setName('');
        setEmail('');
        setPhone('');
        document.getElementById('upload-form').reset();
      } else {
        const errorMessage = data.message || data.error || 'Error uploading file';
        throw new Error(errorMessage);
      }
    } catch (err) {
      console.error('Error:', err);
      setError(err.message);
      setSuccess(false);
    } finally {
      setLoading(false);
    }
  };

  // Test API connection
  const testApi = async () => {
    setLoading(true);
    setError(null);
    
    try {
      console.log('Testing API connection...');
      const response = await fetch('/api/health', {
        method: 'GET',
      });
      
      console.log('Test response status:', response.status);
      
      const responseText = await response.text();
      console.log('Test response text:', responseText);
      
      let data;
      if (responseText && responseText.trim()) {
        try {
          data = JSON.parse(responseText);
        } catch (e) {
          console.error('Error parsing test response:', e);
          data = { success: false, message: 'Invalid JSON response' };
        }
      } else {
        data = { success: response.ok, message: response.ok ? 'API is working' : 'Empty response' };
      }
      
      if (response.ok && data.success !== false) {
        setError('API test successful: ' + (data.message || 'Connected'));
      } else {
        setError('API test failed: ' + (data.message || response.statusText || 'Unknown error'));
      }
    } catch (err) {
      console.error('API test error:', err);
      setError('API connection error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e) => {
    uploadFile(e);
  };

  return (
    <div className="max-w-md mx-auto bg-white rounded-xl shadow-md overflow-hidden md:max-w-2xl p-8 mt-10">
      <h2 className="text-xl font-bold text-gray-900 mb-6">Upload your CV</h2>
      
      {success ? (
        <div className="bg-green-100 border-l-4 border-green-500 text-green-700 p-4 mb-4" role="alert">
          <p className="font-bold">Success!</p>
          <p>Your CV has been uploaded successfully.</p>
          {formData && (
            <div className="mt-2 text-sm">
              <p>Name: {formData.name}</p>
              <p>Email: {formData.email}</p>
              <p>Phone: {formData.phone}</p>
              <p>File: {formData.filename}</p>
            </div>
          )}
        </div>
      ) : (
        <form id="upload-form" onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700">
              Full Name
            </label>
            <input
              type="text"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              required
            />
          </div>
          
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">
              Email Address
            </label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              required
            />
          </div>
          
          <div>
            <label htmlFor="phone" className="block text-sm font-medium text-gray-700">
              Phone Number
            </label>
            <input
              type="tel"
              id="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              required
            />
          </div>
          
          <div>
            <label htmlFor="file" className="block text-sm font-medium text-gray-700">
              Upload CV (PDF, DOCX, TXT)
            </label>
            <input
              type="file"
              id="file"
              onChange={handleFileChange}
              className="mt-1 block w-full text-sm text-gray-500
                file:mr-4 file:py-2 file:px-4
                file:rounded-md file:border-0
                file:text-sm file:font-semibold
                file:bg-blue-50 file:text-blue-700
                hover:file:bg-blue-100"
              accept=".pdf,.docx,.txt"
              required
            />
          </div>
          
          {error && (
            <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4" role="alert">
              <p className="font-bold">Error</p>
              <p>{error}</p>
            </div>
          )}
          
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading}
              className={`inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${
                loading ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              {loading ? 'Uploading...' : 'Upload CV'}
            </button>
            
            <button
              type="button"
              onClick={testApi}
              className="inline-flex justify-center py-2 px-4 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Test API
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
