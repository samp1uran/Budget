import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, onSnapshot, doc, updateDoc, deleteDoc, setDoc, setLogLevel } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

// --- Speech Recognition Setup ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition;
if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.lang = 'en-US';
    recognition.interimResults = false;
}

// --- Audio Utility for Ringtones ---
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
let oscillator;
let gainNode;
const ringtones = { 'Default Beep': [{ freq: 880, duration: 100 }, { freq: 0, duration: 100 }, { freq: 880, duration: 100 }], 'High-Low': [{ freq: 1200, duration: 150 }, { freq: 600, duration: 150 }], 'Intercom': [{ freq: 1046.50, duration: 200 }, { freq: 0, duration: 50 }, { freq: 830.61, duration: 200 }], 'None': [] };
const playRingtone = (ringtoneName = 'Default Beep', activeAlarmRef) => { stopRingtone(); const pattern = ringtones[ringtoneName]; if (!pattern || pattern.length === 0) return; gainNode = audioContext.createGain(); gainNode.connect(audioContext.destination); gainNode.gain.setValueAtTime(0.1, audioContext.currentTime); let currentTime = audioContext.currentTime; const playPattern = () => { pattern.forEach(note => { if (note.freq > 0) { oscillator = audioContext.createOscillator(); oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(note.freq, currentTime); oscillator.connect(gainNode); oscillator.start(currentTime); oscillator.stop(currentTime + note.duration / 1000); } currentTime += note.duration / 1000; }); }; playPattern(); if(oscillator) { oscillator.onended = () => { if (activeAlarmRef && activeAlarmRef.current) setTimeout(playPattern, 500); }; }};
const stopRingtone = () => { if (oscillator) { oscillator.onended = null; try { oscillator.stop(); } catch (e) {} oscillator.disconnect(); oscillator = null; } if (gainNode) { gainNode.disconnect(); gainNode = null; } };

// --- Main App Component ---
export default function App() {
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isReportOpen, setIsReportOpen] = useState(false);
    const [settings, setSettings] = useState({ theme: 'dark', displayName: 'User', appMode: 'tasks', email: '' });
    const [profileName, setProfileName] = useState('');
    const [profileEmail, setProfileEmail] = useState('');
    
    const [tasks, setTasks] = useState([]);
    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(true);

    const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

    useEffect(() => {
        try {
            const app = initializeApp(firebaseConfig);
            const firestoreDb = getFirestore(app);
            const firebaseAuth = getAuth(app);
            setLogLevel('debug');
            setDb(firestoreDb);
            setAuth(firebaseAuth);
            const unsub = onAuthStateChanged(firebaseAuth, async (user) => {
                if (user) setUserId(user.uid);
                else { try { if (initialAuthToken) await signInWithCustomToken(firebaseAuth, initialAuthToken); else await signInAnonymously(firebaseAuth); } catch (e) { console.error("Sign-in error:", e); } }
                setIsAuthReady(true);
            });
            return () => unsub();
        } catch (e) { console.error("Firebase init error:", e); }
    }, [firebaseConfig, initialAuthToken]);

    useEffect(() => {
        if (db && isAuthReady && userId) {
            setLoading(true);
            const settingsPath = `/artifacts/${appId}/users/${userId}/settings/userProfile`;
            const unsubSettings = onSnapshot(doc(db, settingsPath), (snap) => {
                if (snap.exists()) {
                    const data = snap.data();
                    setSettings(prev => ({...prev, ...data}));
                    setProfileName(data.displayName || 'User');
                    setProfileEmail(data.email || '');
                } else {
                    const defaultSettings = { theme: 'dark', displayName: 'User', appMode: 'tasks', email: '' };
                    setDoc(doc(db, settingsPath), defaultSettings).catch(e => console.error(e));
                }
            });

            const tasksPath = `/artifacts/${appId}/users/${userId}/tasks`;
            const qTasks = query(collection(db, tasksPath));
            const unsubTasks = onSnapshot(qTasks, (snap) => {
                const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                data.sort((a, b) => (a.completed === b.completed) ? b.createdAt - a.createdAt : a.completed ? 1 : -1);
                setTasks(data);
                setLoading(false);
            });

            const transPath = `/artifacts/${appId}/users/${userId}/transactions`;
            const qTrans = query(collection(db, transPath));
            const unsubTrans = onSnapshot(qTrans, (snap) => {
                const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                data.sort((a, b) => b.createdAt - a.createdAt);
                setTransactions(data);
            });

            return () => { unsubSettings(); unsubTasks(); unsubTrans(); };
        }
    }, [db, isAuthReady, userId, appId]);

    const handleSettingsUpdate = async (newSettings) => {
        if (!db || !userId) return;
        const path = `/artifacts/${appId}/users/${userId}/settings/userProfile`;
        try { await setDoc(doc(db, path), newSettings, { merge: true }); }
        catch (e) { console.error("Error updating settings:", e); }
    };
    
    const handleProfileSave = () => {
        const newSettings = { ...settings, displayName: profileName, email: profileEmail };
        setSettings(newSettings);
        handleSettingsUpdate(newSettings);
        setIsSettingsOpen(false);
    };

    const theme = settings.theme === 'light' ? 
        { bg: 'bg-gray-100', text: 'text-gray-800', containerBg: 'bg-white', inputBg: 'bg-gray-100', itemBg: 'bg-gray-200', border: 'border-gray-300', subText: 'text-gray-500' } :
        { bg: 'bg-gray-900', text: 'text-white', containerBg: 'bg-gray-800', inputBg: 'bg-gray-700', itemBg: 'bg-gray-700', border: 'border-gray-600', subText: 'text-gray-400' };

    return (
        <div className={settings.theme}>
            <div className={`${theme.bg} ${theme.text} min-h-screen font-sans flex items-center justify-center p-4 transition-colors`}>
                <div className={`w-full max-w-2xl mx-auto ${theme.containerBg} rounded-2xl shadow-2xl p-4 sm:p-6 md:p-8 relative`}>
                    <header className="mb-6 text-center relative">
                        <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-cyan-600 dark:text-cyan-400 mb-2">
                            {settings.displayName}'s {settings.appMode === 'tasks' ? 'Tasks' : 'Budget'}
                        </h1>
                        <p className={theme.subText}>Your Personal {settings.appMode === 'tasks' ? 'Task' : 'Budget'} Tracker</p>
                        <div className="absolute top-0 right-0 flex gap-1 sm:gap-2">
                            <button onClick={() => setIsReportOpen(true)} className={`${theme.subText} hover:text-cyan-500 p-2`} aria-label="Open report">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V7a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                            </button>
                            <button onClick={() => setIsSettingsOpen(true)} className={`${theme.subText} hover:text-cyan-500 p-2`} aria-label="Open settings">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                            </button>
                        </div>
                    </header>
                    
                    {isAuthReady && db && userId ? (
                        settings.appMode === 'budget' ? 
                        <BudgetView db={db} userId={userId} appId={appId} theme={theme} transactions={transactions} loading={loading} /> :
                        <TaskView db={db} userId={userId} appId={appId} theme={theme} tasks={tasks} loading={loading} />
                    ) : <p className="text-center">Loading...</p>}

                </div>
                {isSettingsOpen && <SettingsModal settings={settings} profileName={profileName} setProfileName={setProfileName} profileEmail={profileEmail} setProfileEmail={setProfileEmail} onSettingsChange={handleSettingsUpdate} onSave={handleProfileSave} onClose={() => setIsSettingsOpen(false)} />}
                {isReportOpen && <ReportModal tasks={tasks} transactions={transactions} settings={settings} theme={theme} onClose={() => setIsReportOpen(false)} />}
            </div>
        </div>
    );
}

// --- Task View Component ---
function TaskView({ db, userId, appId, theme, tasks, loading }) {
    const [newTask, setNewTask] = useState('');
    const [isListening, setIsListening] = useState(false);
    const [voiceError, setVoiceError] = useState(null);
    const [feedbackMessage, setFeedbackMessage] = useState('');

    const addTaskByText = async (text) => { if (text.trim() === '') return; await addDoc(collection(db, `/artifacts/${appId}/users/${userId}/tasks`), { text: text.trim(), completed: false, createdAt: Date.now() }); };
    const handleAddTask = async (e) => { e.preventDefault(); await addTaskByText(newTask); setNewTask(''); };
    const handleListen = () => { /* ... voice logic ... */ };

    return (
        <>
            <Clock theme={theme} />
            <form onSubmit={handleAddTask} className="flex gap-2 sm:gap-3 mb-6">
                <input type="text" value={newTask} onChange={(e) => setNewTask(e.target.value)} placeholder="New task..."
                    className={`flex-grow ${theme.inputBg} ${theme.text} placeholder-gray-500 border-2 ${theme.border} rounded-lg px-3 py-3 sm:px-4 focus:outline-none focus:ring-2 focus:ring-cyan-500`} />
                <button type="submit" className="bg-cyan-500 hover:bg-cyan-600 text-white font-bold py-3 px-4 rounded-lg shadow-lg disabled:bg-gray-500" disabled={!newTask.trim()}>Add</button>
                <button type="button" onClick={handleListen} className={`p-3 rounded-lg shadow-lg ${isListening ? 'bg-red-500 animate-pulse' : 'bg-blue-500 hover:bg-blue-600'}`} disabled={!SpeechRecognition}>
                    <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72h-1.7z"></path></svg>
                </button>
            </form>
            {(voiceError || feedbackMessage) && <div className={`p-3 mb-4 rounded-lg text-center text-sm ${voiceError ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-300'}`}>{voiceError || feedbackMessage}</div>}
            
            <div className="text-center py-8 px-4 bg-opacity-50 mt-6 rounded-lg">
                <p className={`${theme.subText} text-lg`}>Add a new task or view your progress in the report.</p>
            </div>
        </>
    );
}

// --- Budget View Component ---
function BudgetView({ db, userId, appId, theme, transactions, loading }) {
    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');
    const [vendor, setVendor] = useState('');
    const [type, setType] = useState('expense');

    const handleAddTransaction = async (e) => {
        e.preventDefault();
        const numAmount = parseFloat(amount);
        if (description.trim() === '' || isNaN(numAmount) || numAmount <= 0) return;
        await addDoc(collection(db, `/artifacts/${appId}/users/${userId}/transactions`), {
            description: description.trim(),
            amount: numAmount,
            vendor: vendor.trim(),
            type,
            createdAt: Date.now()
        });
        setDescription('');
        setAmount('');
        setVendor('');
    };

    const totalIncome = transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
    const totalExpenses = transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
    const balance = totalIncome - totalExpenses;

    return (
        <>
            <Clock theme={theme} />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 text-center">
                <div className="bg-green-500/20 text-green-300 p-4 rounded-lg"><h3 className="font-bold text-xl sm:text-2xl">${totalIncome.toFixed(2)}</h3><p className="text-sm">Total Income</p></div>
                <div className="bg-red-500/20 text-red-300 p-4 rounded-lg"><h3 className="font-bold text-xl sm:text-2xl">${totalExpenses.toFixed(2)}</h3><p className="text-sm">Total Expenses</p></div>
                <div className={`${balance >= 0 ? 'bg-blue-500/20 text-blue-300' : 'bg-yellow-500/20 text-yellow-300'} p-4 rounded-lg`}><h3 className="font-bold text-xl sm:text-2xl">${balance.toFixed(2)}</h3><p className="text-sm">Balance</p></div>
            </div>

            <form onSubmit={handleAddTransaction} className="space-y-4 mb-6">
                <div className="space-y-4">
                     <input type="text" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Vendor / Source" className={`w-full ${theme.inputBg} ${theme.text} border-2 ${theme.border} rounded-lg p-3`} />
                    <div className="flex flex-col sm:flex-row gap-4">
                        <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" className={`w-full ${theme.inputBg} ${theme.text} border-2 ${theme.border} rounded-lg p-3`} />
                        <div className="w-full sm:w-1/2">
                            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" className={`w-full ${theme.inputBg} ${theme.text} border-2 ${theme.border} rounded-lg p-3`} />
                        </div>
                    </div>
                </div>
                <div className="flex gap-4">
                    <button type="button" onClick={() => setType('income')} className={`flex-1 p-3 rounded-lg font-semibold ${type === 'income' ? 'bg-green-500 text-white' : `${theme.itemBg}`}`}>Income</button>
                    <button type="button" onClick={() => setType('expense')} className={`flex-1 p-3 rounded-lg font-semibold ${type === 'expense' ? 'bg-red-500 text-white' : `${theme.itemBg}`}`}>Expense</button>
                </div>
                <button type="submit" className="w-full bg-cyan-500 hover:bg-cyan-600 text-white font-bold py-3 rounded-lg">Add Transaction</button>
            </form>
            
            <div className="text-center py-8 px-4 bg-opacity-50 mt-6 rounded-lg">
                <p className={`${theme.subText} text-lg`}>Add a new transaction or view your summary in the report.</p>
            </div>
        </>
    );
}


// --- Modals & Sub-Components ---
function Clock({ theme }) {
    const [time, setTime] = useState(new Date());
    useEffect(() => { const timerId = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(timerId); }, []);
    const seconds = time.getSeconds(), minutes = time.getMinutes(), hours = time.getHours();
    const secondHandRotation = (seconds / 60) * 360, minuteHandRotation = (minutes / 60) * 360 + (seconds / 60) * 6, hourHandRotation = (hours % 12 / 12) * 360 + (minutes / 60) * 30;
    const clockFaceColor = theme.bg === 'bg-gray-900' ? '#1f2937' : '#f9fafb', clockBorderColor = theme.bg === 'bg-gray-900' ? '#4b5563' : '#d1d5db', handColor = theme.text === 'text-white' ? '#e5e7eb' : '#374151', secondHandColor = '#34d399';
    return (
        <div className={`mb-8 flex flex-col md:flex-row items-center justify-around gap-8 p-4 rounded-lg bg-opacity-50 ${theme.itemBg}`}>
            <div className="w-32 h-32 sm:w-40 sm:h-40">
                <svg viewBox="0 0 200 200" className="w-full h-full">
                    <circle cx="100" cy="100" r="95" fill={clockFaceColor} stroke={clockBorderColor} strokeWidth="4" />
                    {[...Array(12)].map((_, i) => { const angle = i * 30 * (Math.PI / 180), x1 = 100 + 80 * Math.sin(angle), y1 = 100 - 80 * Math.cos(angle), x2 = 100 + 90 * Math.sin(angle), y2 = 100 - 90 * Math.cos(angle); return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={handColor} strokeWidth="2" />; })}
                    <line x1="100" y1="100" x2="100" y2="55" stroke={handColor} strokeWidth="6" strokeLinecap="round" transform={`rotate(${hourHandRotation} 100 100)`} />
                    <line x1="100" y1="100" x2="100" y2="30" stroke={handColor} strokeWidth="4" strokeLinecap="round" transform={`rotate(${minuteHandRotation} 100 100)`} />
                    <line x1="100" y1="110" x2="100" y2="25" stroke={secondHandColor} strokeWidth="2" strokeLinecap="round" transform={`rotate(${secondHandRotation} 100 100)`} />
                    <circle cx="100" cy="100" r="5" fill={secondHandColor} />
                </svg>
            </div>
            <div className="text-center">
                <p className="text-4xl md:text-5xl font-mono tracking-wider">{time.toLocaleTimeString('en-US')}</p>
                <p className={`mt-2 text-base sm:text-lg ${theme.subText}`}>{time.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
            </div>
        </div>
    );
}

function SettingsModal({ settings, profileName, setProfileName, profileEmail, setProfileEmail, onSettingsChange, onSave, onClose }) {
    const handleThemeChange = (theme) => onSettingsChange({ ...settings, theme });
    const handleModeChange = (appMode) => onSettingsChange({ ...settings, appMode });
    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className={`${settings.theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-white text-gray-800'} rounded-2xl p-6 sm:p-8 w-full max-w-md`} onClick={(e) => e.stopPropagation()}>
                <h2 className="text-2xl font-bold mb-6">Profile & Settings</h2>
                <div className="space-y-6">
                    <div>
                        <label className="block font-medium mb-2">App Mode</label>
                        <div className="flex gap-4">
                            <button onClick={() => handleModeChange('tasks')} className={`flex-1 p-3 rounded-lg font-semibold border-2 ${settings.appMode === 'tasks' ? 'bg-cyan-500 text-white border-cyan-500' : `${themeClasses(settings.theme).itemBg} ${themeClasses(settings.theme).border}`}`}>Task Tracker</button>
                            <button onClick={() => handleModeChange('budget')} className={`flex-1 p-3 rounded-lg font-semibold border-2 ${settings.appMode === 'budget' ? 'bg-cyan-500 text-white border-cyan-500' : `${themeClasses(settings.theme).itemBg} ${themeClasses(settings.theme).border}`}`}>Budget Tracker</button>
                        </div>
                    </div>
                    <div>
                        <label htmlFor="displayName" className="block font-medium mb-2">Display Name</label>
                        <input id="displayName" type="text" value={profileName} onChange={(e) => setProfileName(e.target.value)} className={`w-full ${themeClasses(settings.theme).inputBg} ${themeClasses(settings.theme).text} border-2 ${themeClasses(settings.theme).border} rounded-lg p-2`} />
                    </div>
                     <div>
                        <label htmlFor="email" className="block font-medium mb-2">Reminder Email</label>
                        <input id="email" type="email" value={profileEmail} onChange={(e) => setProfileEmail(e.target.value)} placeholder="user@example.com" className={`w-full ${themeClasses(settings.theme).inputBg} ${themeClasses(settings.theme).text} border-2 ${themeClasses(settings.theme).border} rounded-lg p-2`} />
                    </div>
                    <div>
                        <label className="block font-medium mb-2">Theme</label>
                        <div className="flex gap-4">
                            <button onClick={() => handleThemeChange('light')} className={`flex-1 p-3 rounded-lg font-semibold border-2 ${settings.theme === 'light' ? 'bg-cyan-500 text-white border-cyan-500' : `${themeClasses(settings.theme).itemBg} ${themeClasses(settings.theme).border}`}`}>Light</button>
                            <button onClick={() => handleThemeChange('dark')} className={`flex-1 p-3 rounded-lg font-semibold border-2 ${settings.theme === 'dark' ? 'bg-cyan-500 text-white border-cyan-500' : `${themeClasses(settings.theme).itemBg} ${themeClasses(settings.theme).border}`}`}>Dark</button>
                        </div>
                    </div>
                </div>
                <button onClick={onSave} className="mt-8 w-full bg-cyan-500 hover:bg-cyan-600 text-white font-bold py-3 rounded-lg">Save & Close</button>
            </div>
        </div>
    );
}

function ReportModal({ tasks, transactions, settings, theme, onClose }) {
    const completedTasks = tasks.filter(t => t.completed).length;
    const totalTasks = tasks.length;
    const completionRate = totalTasks > 0 ? ((completedTasks / totalTasks) * 100).toFixed(0) : 0;

    const totalIncome = transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
    const expenses = transactions.filter(t => t.type === 'expense');
    const totalExpenses = expenses.reduce((sum, t) => sum + t.amount, 0);
    const balance = totalIncome - totalExpenses;

    const spendingByVendor = expenses.reduce((acc, transaction) => {
        const vendor = transaction.vendor || 'Uncategorized';
        acc[vendor] = (acc[vendor] || 0) + transaction.amount;
        return acc;
    }, {});

    const sortedVendors = Object.entries(spendingByVendor)
        .map(([vendor, amount]) => ({ vendor, amount }))
        .sort((a, b) => b.amount - a.amount);

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className={`${theme.bg === 'bg-gray-900' ? 'bg-gray-800 text-white' : 'bg-white text-gray-800'} rounded-2xl p-6 sm:p-8 w-full max-w-lg max-h-[90vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
                <h2 className="text-2xl font-bold mb-6 text-center">Activity Report</h2>
                <div className="space-y-6">
                    <div className={`p-4 rounded-lg ${theme.itemBg}`}>
                        <h3 className="text-lg font-semibold mb-3 text-cyan-400">User Profile</h3>
                        <p><span className={theme.subText}>Name:</span> {settings.displayName}</p>
                        <p><span className={theme.subText}>Reminder Email:</span> {settings.email || 'Not set'}</p>
                    </div>
                    <div className={`p-4 rounded-lg ${theme.itemBg}`}>
                        <h3 className="text-lg font-semibold mb-3 text-cyan-400">Task Summary</h3>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="text-center"><p className="text-2xl font-bold">{totalTasks}</p><p className={theme.subText}>Total Tasks</p></div>
                            <div className="text-center"><p className="text-2xl font-bold">{completedTasks}</p><p className={theme.subText}>Completed</p></div>
                            <div className="text-center"><p className="text-2xl font-bold">{totalTasks - completedTasks}</p><p className={theme.subText}>Pending</p></div>
                            <div className="text-center"><p className="text-2xl font-bold">{completionRate}%</p><p className={theme.subText}>Completion Rate</p></div>
                        </div>
                    </div>
                    <div className={`p-4 rounded-lg ${theme.itemBg}`}>
                        <h3 className="text-lg font-semibold mb-3 text-cyan-400">Budget Summary</h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="text-center"><p className="text-xl font-bold text-green-400">${totalIncome.toFixed(2)}</p><p className={theme.subText}>Total Income</p></div>
                            <div className="text-center"><p className="text-xl font-bold text-red-400">${totalExpenses.toFixed(2)}</p><p className={theme.subText}>Total Expenses</p></div>
                            <div className="text-center"><p className={`text-xl font-bold ${balance >= 0 ? 'text-blue-400' : 'text-yellow-400'}`}>${balance.toFixed(2)}</p><p className={theme.subText}>Net Balance</p></div>
                        </div>
                    </div>
                     <div className={`p-4 rounded-lg ${theme.itemBg}`}>
                        <h3 className="text-lg font-semibold mb-3 text-cyan-400">Spending by Vendor</h3>
                        {sortedVendors.length > 0 ? (
                            <div className="space-y-3">
                                {sortedVendors.map(({ vendor, amount }) => {
                                    const percentage = totalExpenses > 0 ? (amount / totalExpenses) * 100 : 0;
                                    return (
                                        <div key={vendor}>
                                            <div className="flex justify-between items-center text-sm mb-1">
                                                <span>{vendor}</span>
                                                <span>${amount.toFixed(2)}</span>
                                            </div>
                                            <div className={`w-full ${theme.bg} rounded-full h-2.5`}>
                                                <div className="bg-cyan-500 h-2.5 rounded-full" style={{ width: `${percentage}%` }}></div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <p className={theme.subText}>No expenses to categorize.</p>
                        )}
                    </div>
                </div>
                <button onClick={onClose} className="mt-8 w-full bg-gray-500 hover:bg-gray-600 text-white font-bold py-3 rounded-lg">Close</button>
            </div>
        </div>
    );
}

const themeClasses = (theme) => theme === 'light' ? 
    { itemBg: 'bg-gray-100', border: 'border-gray-300', inputBg: 'bg-gray-100', text: 'text-gray-800' } :
    { itemBg: 'bg-gray-700', border: 'border-gray-600', inputBg: 'bg-gray-700', text: 'text-white' };
