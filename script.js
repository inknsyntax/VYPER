// System Launch
function launchSystem() {
    document.getElementById('splash').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    initMap();
    speak("VYPER protocols initialized. Welcome back, User.");
}

// Module Navigation
function showModule(modId) {
    document.querySelectorAll('.module').forEach(m => m.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    
    document.getElementById(modId).classList.add('active');
    // Added a check to make sure the event exists before calling it
    if(event) event.currentTarget.classList.add('active');
}

// Voice Engine
function speak(text) {
    const synth = window.speechSynthesis;
    const utter = new SpeechSynthesisUtterance(text);
    utter.pitch = 0.7; 
    utter.rate = 1.1;
    synth.speak(utter);
}

// AI Engine (Local Logic)
function runAI() {
    const input = document.getElementById('aiInput').value.toLowerCase();
    const output = document.getElementById('aiOutput');
    let response = "Error: Input not recognized by core logic.";

    if (input.includes("hello") || input.includes("hey")) response = "System online. Standing by for instructions.";
    if (input.includes("who are you")) response = "I am V.Y.P.E.R. Your Virtual Yielding Personal Emergent Responder.";
    if (input.includes("clear")) { output.innerText = ""; return; }
    
    output.innerText = `> ${response}`;
    speak(response);
}

// Map Engine
let map;
function initMap() {
    if(!map) {
        map = L.map('map', {
            zoomControl: true,
            attributionControl: false 
        }).setView([51.505, -0.09], 13);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
        
        speak("Satellite link established. Decrypting regional coordinates.");
    }
}

// Dictionary Query
async function runDefine() {
    const word = document.getElementById('defInput').value;
    const output = document.getElementById('defOutput');
    try {
        const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`);
        const data = await res.json();
        const definition = data[0].meanings[0].definitions[0].definition;
        output.innerText = `DEFINITION: ${definition}`;
        speak(definition);
    } catch (err) {
        output.innerText = "Error: Term not found in database.";
    }
}

// Weather Engine
async function runWeather() {
    const output = document.getElementById('weatherOutput');
    navigator.geolocation.getCurrentPosition(async (pos) => {
        const { latitude, longitude } = pos.coords;
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`);
        const data = await res.json();
        const report = `Surface Temp: ${data.current_weather.temperature}°C. Wind: ${data.current_weather.windspeed} km/h.`;
        output.innerText = report;
        speak(report);
    }, () => {
        output.innerText = "Error: Location access denied.";
        speak("Location access denied.");
    });
}

// Clock
setInterval(() => {
    document.getElementById('clock').innerText = new Date().toLocaleTimeString();
}, 1000);

// Simple Utilities
function convert() {
    const val = document.getElementById('unitVal').value;
    const type = document.getElementById('unitType').value;
    const res = type === "ktom" ? val * 0.621 : val / 0.621;
    document.getElementById('unitResult').innerText = `RESULT: ${res.toFixed(2)}`;
}

function calculate() {
    try {
        const res = eval(document.getElementById('calcInput').value);
        document.getElementById('calcResult').innerText = `RESULT: ${res}`;
    } catch (e) {
        document.getElementById('calcResult').innerText = "CALCULATION_ERROR";
    }
}

async function searchMap() {
    const query = document.getElementById('mapSearch').value;
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${query}`);
        const data = await res.json();
        if(data.length > 0) {
            const { lat, lon } = data[0];
            map.flyTo([lat, lon], 14, { duration: 2 });
            speak(`Relocating to ${query}. Connection stable.`);
        }
    } catch (err) {
        speak("Coordinate jump failed. Signal lost.");
    }
}
