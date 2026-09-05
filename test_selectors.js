// Test what document.querySelector returns at document_start
// This simulates what the content script does

// The form selectors from content.js
const selectors = ['.quantumWizForm', '.docjsForm', '[role="form"]', '#viewform'];

// In a real Google Forms page, some of these might match
// Let's check which ones would typically match on a Google Forms page

// Google Forms typically have a form container with class quantumWizForm
// The form also has role="form" in many cases
// #viewform is the ID of the form page itself

// Let's simulate checking each selector
const simulatedResults = {
  '.quantumWizForm': true,  // Google Forms have this class
  '.docjsForm': false,      // Not typically used
  '[role="form"]': true,   // Often have role="form"
  '#viewform': true         // The form page has id="viewform"
};

console.log('Simulated form detection results:');
for (const selector of selectors) {
  const found = simulatedResults[selector] || false;
  console.log(`${selector}: ${found ? 'found' : 'not found'}`);
}

// Check if any selector matches
const anyFound = selectors.some(s => simulatedResults[s] || false);
console.log(`\nAny form selector found: ${anyFound}`);
console.log(`\nWould return: ${anyFound ? 'true (Google Form)' : 'false (not a Google Form)'}`);