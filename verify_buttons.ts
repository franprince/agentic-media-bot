
// Regex-only extraction test (no need for processUserMessage which requires complex mocks)
// import { processUserMessage } from "./src/agent/index.ts";

// Mocking dependencies would be complex for a quick check, 
// so let's just test a small part of the logic by calling the real function with a dummy user.
// However, since it calls LLMs, I'll create a dedicated unit test file instead if possible.
// Wait, I can just create a small scratch script to regex test the logic I added.

const text = `
I found the movie Inception (2010). Do you want me to add it?

POSTER: https://image.tmdb.org/t/p/w500/edv5CZvj0VeF9oOsnvYqC2pQ6Z7.jpg
BUTTON: Yes, add it! | add_movie_confirm
BUTTON: No, thanks | cancel_action
`;

const posterMatch = text.match(/POSTER:.*?(https?:\/\/\S+)/i);
let imageUrl: string | undefined;
let processedText = text;
if (posterMatch) {
    imageUrl = posterMatch[1];
    processedText = processedText.replace(/POSTER:.*?(https?:\/\/\S+)/i, "").trim();
}

const buttonMatches = processedText.matchAll(/^BUTTON:\s*(.*?)\s*\|\s*(.*?)\s*$/gim);
const buttons: Array<{ text: string, data: string }> = [];
for (const match of buttonMatches) {
    if (match[1] && match[2]) {
        buttons.push({ text: match[1].trim(), data: match[2].trim() });
    }
}

processedText = processedText.replace(/^BUTTON:.*$/gim, "").trim();

console.log("--- RESULTS ---");
console.log("Text:", processedText);
console.log("Image URL:", imageUrl);
console.log("Buttons:", JSON.stringify(buttons, null, 2));

if (buttons.length === 2) {
    const [btn1, btn2] = [buttons[0]!, buttons[1]!];
    if (btn1.text === "Yes, add it!" && btn2.data === "cancel_action") {
        console.log("✅ Extraction test passed!");
    } else {
        console.log("❌ Extraction test failed!");
        process.exit(1);
    }
} else {
    console.log("❌ Extraction test failed (wrong number of buttons)!");
    process.exit(1);
}
