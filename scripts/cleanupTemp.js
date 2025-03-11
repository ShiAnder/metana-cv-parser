/**
 * Utility script to clean up all temporary files in the temp directory
 * Run with: node scripts/cleanupTemp.js
 */

const fs = require('fs');
const path = require('path');

// Path to the temp directory
const tempDir = path.resolve('./temp');

console.log(`Cleaning up temporary files in: ${tempDir}`);

if (!fs.existsSync(tempDir)) {
  console.log('Temp directory does not exist. Nothing to clean up.');
  process.exit(0);
}

// Get all files in the temp directory
const files = fs.readdirSync(tempDir);

if (files.length === 0) {
  console.log('No temporary files found.');
} else {
  console.log(`Found ${files.length} temporary files to clean up.`);
  
  // Delete each file
  let deletedCount = 0;
  let errorCount = 0;
  
  files.forEach(file => {
    const filePath = path.join(tempDir, file);
    
    try {
      fs.unlinkSync(filePath);
      console.log(`Deleted: ${filePath}`);
      deletedCount++;
    } catch (error) {
      console.error(`Error deleting ${filePath}:`, error);
      errorCount++;
    }
  });
  
  console.log(`
Cleanup complete:
- ${deletedCount} files deleted successfully
- ${errorCount} files failed to delete
  `);
}

console.log('Temp file cleanup finished.'); 