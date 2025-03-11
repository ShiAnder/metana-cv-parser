This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Environment Variables

This application requires several environment variables to be set for proper functionality. Create a `.env` file in the root directory based on the `.env.example` template. There are two options for configuring Google Cloud:

### Option 1: Individual Environment Variables

- `GOOGLE_PROJECT_ID`: Your Google Cloud Platform project ID
- `GOOGLE_STORAGE_BUCKET`: The name of your Google Cloud Storage bucket
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`: The email address of your Google service account
- `GOOGLE_PRIVATE_KEY`: The private key for your Google service account (with newlines escaped as `\n`)
- `GOOGLE_SPREADSHEET_ID`: The ID of your Google Sheets spreadsheet

### Option 2: JSON Credentials File

Alternatively, you can use the contents of your service account JSON key file:

- `GCS_CREDENTIALS`: The entire JSON object from your service account key file
- `GCS_BUCKET_NAME`: The name of your Google Cloud Storage bucket

To create a service account key file:
1. Go to the Google Cloud Console
2. Navigate to IAM & Admin > Service Accounts
3. Select your service account or create a new one
4. Under "Keys" tab, click "Add Key" > "Create new key"
5. Select JSON format and click "Create"
6. Save the downloaded file and copy its contents into your GCS_CREDENTIALS variable

### Email Configuration
- `EMAIL_FROM`: The sender email address
- `EMAIL_HOST`: SMTP server hostname
- `EMAIL_PORT`: SMTP server port (usually 587)
- `EMAIL_USER`: SMTP username
- `EMAIL_PASS`: SMTP password
- `EMAIL_SECURE`: Whether to use TLS (true/false)

### Vercel Deployment
When deploying to Vercel, add these environment variables in the Vercel project settings under Environment Variables. If using Option 2 (JSON credentials), make sure to paste the entire JSON object without any line breaks.

### Google Cloud Storage Setup

This application uploads files to Google Cloud Storage. Make sure your storage bucket is properly configured:

1. **Uniform Bucket-Level Access**: If you have uniform bucket-level access enabled (recommended), you need to set bucket-level permissions:
   - Go to your bucket in GCS console
   - Click on "Permissions" tab
   - Add a new permission with:
     - Principal: `allUsers` (for public access) or specific users/services
     - Role: "Storage Object Viewer" (for read-only access)

2. **CORS Configuration**: For browser uploads, set a CORS policy on your bucket:
   - Go to your bucket in GCS console
   - Click on "CORS" in the settings menu
   - Add the following configuration:
   ```json
   [
     {
       "origin": ["*"],
       "method": ["GET", "POST", "PUT"],
       "responseHeader": ["Content-Type", "x-goog-resumable"],
       "maxAgeSeconds": 3600
     }
   ]
   ```
