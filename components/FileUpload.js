"use client";

import React, { useState, useEffect } from 'react';

export default function FileUpload() {
  const [file, setFile] = useState(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);
  const [formData, setFormData] = useState(null);
  const [uploadId, setUploadId] = useState(null);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Poll upload status if we have an upload ID
  useEffect(() => {
    let statusInterval;
    
    if (uploadId && !success && !error) {
      console.log('Starting status polling for upload ID:', uploadId);
      statusInterval = setInterval(checkUploadStatus, 5000);
    }
    
    return () => {
      if (statusInterval) {
        clearInterval(statusInterval);
      }
    };
  }, [uploadId, success, error]);

  const checkUploadStatus = async () => {
    if (!uploadId) return;
    
    try {
      console.log('Checking status for upload ID:', uploadId);
      const response = await fetch(`/api/direct-upload?id=${uploadId}`, {
        method: 'GET',
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log('Status update:', data);
        
        if (data.status) {
          setUploadStatus(data.status.stage);
          setUploadProgress(data.status.progress || 0);
          
          // Check for completion or error
          if (data.status.stage === 'completed') {
            setSuccess(true);
            setLoading(false);
            clearInterval(statusInterval);
          } else if (data.status.stage === 'error') {
            setError(data.status.error || 'Error during processing');
            setLoading(false);
            clearInterval(statusInterval);
          }
        }
      } else {
        console.warn('Failed to get status update:', response.status);
      }
    } catch (err) {
      console.error('Error checking upload status:', err);
    }
  };

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
    setUploadId(null);
    setUploadStatus(null);
    setUploadProgress(0);

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
        // Store upload ID for status checking
        if (data.uploadId) {
          setUploadId(data.uploadId);
          console.log('Upload ID received:', data.uploadId);
          setUploadStatus('received');
          setUploadProgress(0);
          
          // We'll keep loading state active until processing completes
          // The status polling in useEffect will update the status
        } else {
          // Legacy response without upload ID
          setSuccess(true);
          setLoading(false);
        }
        
        setFormData({
          name,
          email,
          phone,
          filename: file.name
        });
      } else {
        const errorMessage = data.message || data.error || 'Error uploading file';
        throw new Error(errorMessage);
      }
    } catch (err) {
      console.error('Error:', err);
      setError(err.message);
      setSuccess(false);
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

  // Progress indicator component
  const ProgressIndicator = ({ status, progress }) => {
    const getStatusLabel = (status) => {
      switch(status) {
        case 'received': return 'Received file';
        case 'extracting_text': return 'Extracting text';
        case 'uploading_to_cloud': return 'Uploading to cloud';
        case 'saving_to_sheets': return 'Saving to Google Sheets';
        case 'sending_email': return 'Sending confirmation email';
        case 'completed': return 'Completed';
        case 'error': return 'Error';
        default: return 'Processing';
      }
    };
    
    return (
      <div className="mt-4">
        <div className="flex justify-between mb-1">
          <span className="text-base font-medium text-blue-700">{getStatusLabel(status)}</span>
          <span className="text-sm font-medium text-blue-700">{progress}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2.5">
          <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${progress}%` }}></div>
        </div>
      </div>
    );
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
          
          {loading && uploadStatus && (
            <ProgressIndicator status={uploadStatus} progress={uploadProgress} />
          )}
          
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
