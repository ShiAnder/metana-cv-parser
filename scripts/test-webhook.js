import { testWebhook } from '../lib/webhook.js';

async function runTest() {
  console.log('Starting webhook availability test...');
  console.log('Node.js version:', process.version);
  console.log('Current directory:', process.cwd());
  
  try {
    const result = await testWebhook();
    
    if (result) {
      console.log('\n✅ Webhook test passed successfully');
      console.log('The webhook endpoint is available and responding correctly');
    } else {
      console.log('\n❌ Webhook test failed');
      console.log('Please check the error logs above for details');
    }
  } catch (error) {
    console.error('\n❌ Test execution failed:', error.message);
    console.error('Error details:', error);
    process.exit(1);
  }
}

runTest(); 