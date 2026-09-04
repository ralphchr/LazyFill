// Analyze the detection function
function analyzeDetection() {
  // Simulate the user's URL
  const hostname = 'docs.google.com';
  const pathname = '/forms/d/e/1FAIpQLSfDBzDZY0FKpm4FAZhShMf1lBl5-ngTPVFP8rcPEpkqBk-T9A/viewform';
  
  // The detection function from content.js
  const e = hostname;
  const t = pathname;
  const n = e.includes('google.com') || e.includes('forms.gle');
  const r = t.includes('/forms/') || e.includes('forms.google.com') || e.includes('forms.gle');
  
  console.log('Hostname:', e);
  console.log('Pathname:', t);
  console.log('n (is google domain):', n);
  console.log('r (is forms path):', r);
  console.log('!n||!r:', !n||!r);
  
  if (!n || !r) {
    console.log('Result: Would return false early (not a Google domain or not forms path)');
    return;
  }
  
  // Check form selectors
  const formSelectors = ['.quantumWizForm', '.docjsForm', '[role="form"]', '#viewform'];
  
  // Simulate document.querySelector
  // Google Forms typically have .quantumWizForm
  let formFound = false;
  for (const selector of formSelectors) {
    // Check if selector would match
    const matches = selector === '.quantumWizForm'; // Assume quantumWizForm matches
    if (matches) {
      formFound = true;
      break;
    }
  }
  
  console.log('Form selectors found:', formFound);
  console.log('Final result:', formFound ? 'true (Google Form)' : 'false (not a Google Form)');
}

analyzeDetection();