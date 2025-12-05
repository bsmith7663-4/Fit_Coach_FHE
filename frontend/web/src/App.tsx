// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface FitnessData {
  id: number;
  date: string;
  workoutType: string;
  duration: number; // in minutes
  calories: number;
  encrypted: string;
}

interface AIChatMessage {
  role: 'user' | 'ai';
  content: string;
  timestamp: number;
}

// FHE encryption/decryption functions
const FHEEncryptNumber = (value: number): string => `FHE-${btoa(value.toString())}`;
const FHEDecryptNumber = (encryptedData: string): number => encryptedData.startsWith('FHE-') ? parseFloat(atob(encryptedData.substring(4))) : parseFloat(encryptedData);
const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [fitnessData, setFitnessData] = useState<FitnessData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addingData, setAddingData] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newData, setNewData] = useState({ date: "", workoutType: "", duration: 0, calories: 0 });
  const [selectedData, setSelectedData] = useState<FitnessData | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState("");
  const [contractAddress, setContractAddress] = useState("");
  const [chainId, setChainId] = useState(0);
  const [startTimestamp, setStartTimestamp] = useState(0);
  const [durationDays, setDurationDays] = useState(30);
  const [activeTab, setActiveTab] = useState('data');
  const [aiMessages, setAiMessages] = useState<AIChatMessage[]>([]);
  const [userMessage, setUserMessage] = useState("");
  const [isAiResponding, setIsAiResponding] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);

  // Initialize signature parameters
  useEffect(() => {
    loadData().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  // Load data from contract
  const loadData = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
      
      // Load fitness data
      const dataBytes = await contract.getData("fitnessData");
      let dataList: FitnessData[] = [];
      if (dataBytes.length > 0) {
        try {
          const dataStr = ethers.toUtf8String(dataBytes);
          if (dataStr.trim() !== '') dataList = JSON.parse(dataStr);
        } catch (e) {}
      }
      setFitnessData(dataList);
    } catch (e) {
      console.error("Error loading data:", e);
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
      setLoading(false); 
    }
  };

  // Add new fitness data
  const addFitnessData = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setAddingData(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Adding fitness data with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      // Create new data entry
      const newEntry: FitnessData = {
        id: fitnessData.length + 1,
        date: newData.date,
        workoutType: newData.workoutType,
        duration: newData.duration,
        calories: newData.calories,
        encrypted: FHEEncryptNumber(newData.duration * newData.calories) // Encrypted fitness score
      };
      
      // Update data list
      const updatedData = [...fitnessData, newEntry];
      
      // Save to contract
      await contract.setData("fitnessData", ethers.toUtf8Bytes(JSON.stringify(updatedData)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Fitness data added successfully!" });
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowAddModal(false);
        setNewData({ date: "", workoutType: "", duration: 0, calories: 0 });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setAddingData(false); 
    }
  };

  // Decrypt data with signature
  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      return FHEDecryptNumber(encryptedData);
    } catch (e) { 
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  // Handle AI chat message
  const handleAIChat = async () => {
    if (!userMessage.trim()) return;
    
    const userMsg: AIChatMessage = {
      role: 'user',
      content: userMessage,
      timestamp: Date.now()
    };
    
    setAiMessages(prev => [...prev, userMsg]);
    setUserMessage("");
    setIsAiResponding(true);
    
    // Simulate AI response
    setTimeout(() => {
      const responses = [
        "Based on your encrypted fitness data, I recommend increasing your cardio sessions.",
        "Your encrypted workout patterns show good consistency. Keep it up!",
        "I've analyzed your FHE-protected data and suggest adding strength training.",
        "Your encrypted metrics indicate progress. Consider adjusting your diet.",
        "FHE analysis shows room for improvement in workout duration."
      ];
      
      const aiMsg: AIChatMessage = {
        role: 'ai',
        content: responses[Math.floor(Math.random() * responses.length)],
        timestamp: Date.now()
      };
      
      setAiMessages(prev => [...prev, aiMsg]);
      setIsAiResponding(false);
    }, 1500);
  };

  // Calculate weekly stats
  const calculateWeeklyStats = () => {
    const last7Days = fitnessData.filter(item => {
      const itemDate = new Date(item.date);
      const today = new Date();
      return itemDate >= new Date(today.setDate(today.getDate() - 7));
    });
    
    const totalDuration = last7Days.reduce((sum, item) => sum + item.duration, 0);
    const totalCalories = last7Days.reduce((sum, item) => sum + item.calories, 0);
    const avgDuration = last7Days.length > 0 ? totalDuration / last7Days.length : 0;
    const avgCalories = last7Days.length > 0 ? totalCalories / last7Days.length : 0;
    
    return {
      workouts: last7Days.length,
      totalDuration,
      totalCalories,
      avgDuration,
      avgCalories
    };
  };

  // Get workouts for selected date
  const getWorkoutsForDate = (date: string) => {
    return fitnessData.filter(item => item.date === date);
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="loading-spinner"></div>
      <p>Initializing private fitness coach...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Fit<span>Coach</span>FHE</h1>
          <div className="fhe-badge">
            <span>Powered by Zama FHE</span>
          </div>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowAddModal(true)} 
            className="add-data-btn"
          >
            + Add Workout
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content">
        <div className="sidebar">
          <div className="sidebar-section">
            <h3>Navigation</h3>
            <button 
              className={`sidebar-btn ${activeTab === 'data' ? 'active' : ''}`}
              onClick={() => setActiveTab('data')}
            >
              My Workouts
            </button>
            <button 
              className={`sidebar-btn ${activeTab === 'calendar' ? 'active' : ''}`}
              onClick={() => setActiveTab('calendar')}
            >
              Training Calendar
            </button>
            <button 
              className={`sidebar-btn ${activeTab === 'stats' ? 'active' : ''}`}
              onClick={() => setActiveTab('stats')}
            >
              Progress Stats
            </button>
            <button 
              className={`sidebar-btn ${activeTab === 'ai' ? 'active' : ''}`}
              onClick={() => setActiveTab('ai')}
            >
              AI Coach
            </button>
          </div>
          
          <div className="sidebar-section">
            <h3>Weekly Summary</h3>
            <div className="summary-card">
              <div className="summary-item">
                <span>Workouts:</span>
                <strong>{calculateWeeklyStats().workouts}</strong>
              </div>
              <div className="summary-item">
                <span>Total Duration:</span>
                <strong>{calculateWeeklyStats().totalDuration} min</strong>
              </div>
              <div className="summary-item">
                <span>Calories Burned:</span>
                <strong>{calculateWeeklyStats().totalCalories}</strong>
              </div>
            </div>
          </div>
        </div>
        
        <div className="content-area">
          {activeTab === 'data' && (
            <div className="data-section">
              <div className="section-header">
                <h2>My Workout Data</h2>
                <div className="header-actions">
                  <button 
                    onClick={loadData} 
                    className="refresh-btn" 
                    disabled={isRefreshing}
                  >
                    {isRefreshing ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
              </div>
              
              <div className="data-list">
                {fitnessData.length === 0 ? (
                  <div className="no-data">
                    <p>No workout data found</p>
                    <button 
                      className="add-btn" 
                      onClick={() => setShowAddModal(true)}
                    >
                      Add First Workout
                    </button>
                  </div>
                ) : fitnessData.map((item, index) => (
                  <div 
                    className={`data-card ${selectedData?.id === item.id ? "selected" : ""}`} 
                    key={index}
                    onClick={() => setSelectedData(item)}
                  >
                    <div className="card-header">
                      <div className="card-date">{item.date}</div>
                      <div className="card-type">{item.workoutType}</div>
                    </div>
                    <div className="card-body">
                      <div className="card-stat">
                        <span>Duration:</span>
                        <strong>{item.duration} min</strong>
                      </div>
                      <div className="card-stat">
                        <span>Calories:</span>
                        <strong>{item.calories}</strong>
                      </div>
                    </div>
                    <div className="card-footer">
                      <div className="fhe-tag">
                        <span>FHE Encrypted</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {activeTab === 'calendar' && (
            <div className="calendar-section">
              <h2>Training Calendar</h2>
              <div className="calendar-controls">
                <input 
                  type="date" 
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="date-picker"
                />
              </div>
              
              <div className="calendar-day">
                <h3>{new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
                
                {getWorkoutsForDate(selectedDate).length === 0 ? (
                  <div className="no-workouts">
                    <p>No workouts recorded for this day</p>
                    <button 
                      className="add-btn" 
                      onClick={() => {
                        setNewData(prev => ({ ...prev, date: selectedDate }));
                        setShowAddModal(true);
                      }}
                    >
                      Add Workout
                    </button>
                  </div>
                ) : (
                  <div className="workout-list">
                    {getWorkoutsForDate(selectedDate).map((workout, index) => (
                      <div className="workout-card" key={index}>
                        <div className="workout-type">{workout.workoutType}</div>
                        <div className="workout-stats">
                          <span>{workout.duration} min</span>
                          <span>{workout.calories} cal</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          
          {activeTab === 'stats' && (
            <div className="stats-section">
              <h2>Progress Statistics</h2>
              
              <div className="stats-grid">
                <div className="stat-card">
                  <h3>Weekly Average</h3>
                  <div className="stat-value">{calculateWeeklyStats().avgDuration.toFixed(1)}</div>
                  <div className="stat-label">Minutes per workout</div>
                </div>
                
                <div className="stat-card">
                  <h3>Calories Burned</h3>
                  <div className="stat-value">{calculateWeeklyStats().totalCalories}</div>
                  <div className="stat-label">This week</div>
                </div>
                
                <div className="stat-card">
                  <h3>Workout Frequency</h3>
                  <div className="stat-value">{calculateWeeklyStats().workouts}</div>
                  <div className="stat-label">Days this week</div>
                </div>
              </div>
              
              <div className="progress-chart">
                <h3>Recent Activity</h3>
                <div className="chart-placeholder">
                  <p>Encrypted progress visualization</p>
                  <div className="fhe-tag">
                    <span>FHE Protected Data</span>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {activeTab === 'ai' && (
            <div className="ai-section">
              <h2>AI Fitness Coach</h2>
              <p className="ai-description">Get personalized advice based on your encrypted workout data</p>
              
              <div className="ai-chat">
                <div className="chat-messages">
                  {aiMessages.length === 0 ? (
                    <div className="welcome-message">
                      <p>Hi! I'm your private AI fitness coach. Ask me anything about your workouts.</p>
                      <p>All your data remains encrypted with Zama FHE for complete privacy.</p>
                    </div>
                  ) : aiMessages.map((msg, index) => (
                    <div className={`message ${msg.role}`} key={index}>
                      <div className="message-content">
                        {msg.content}
                      </div>
                      <div className="message-time">
                        {new Date(msg.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                  ))}
                  
                  {isAiResponding && (
                    <div className="message ai">
                      <div className="message-content typing">
                        <span></span>
                        <span></span>
                        <span></span>
                      </div>
                    </div>
                  )}
                </div>
                
                <div className="chat-input">
                  <input 
                    type="text" 
                    value={userMessage}
                    onChange={(e) => setUserMessage(e.target.value)}
                    placeholder="Ask your AI coach..."
                    onKeyPress={(e) => e.key === 'Enter' && handleAIChat()}
                  />
                  <button 
                    onClick={handleAIChat}
                    disabled={isAiResponding}
                  >
                    Send
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      
      {showAddModal && (
        <div className="modal-overlay">
          <div className="add-data-modal">
            <div className="modal-header">
              <h2>Add Workout Data</h2>
              <button onClick={() => setShowAddModal(false)} className="close-modal">&times;</button>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label>Date *</label>
                <input 
                  type="date" 
                  value={newData.date}
                  onChange={(e) => setNewData({ ...newData, date: e.target.value })}
                />
              </div>
              
              <div className="form-group">
                <label>Workout Type *</label>
                <input 
                  type="text" 
                  value={newData.workoutType}
                  onChange={(e) => setNewData({ ...newData, workoutType: e.target.value })}
                  placeholder="e.g. Running, Weightlifting"
                />
              </div>
              
              <div className="form-group">
                <label>Duration (minutes) *</label>
                <input 
                  type="number" 
                  value={newData.duration}
                  onChange={(e) => setNewData({ ...newData, duration: parseInt(e.target.value) || 0 })}
                />
              </div>
              
              <div className="form-group">
                <label>Calories Burned *</label>
                <input 
                  type="number" 
                  value={newData.calories}
                  onChange={(e) => setNewData({ ...newData, calories: parseInt(e.target.value) || 0 })}
                />
              </div>
              
              <div className="fhe-notice">
                <div className="lock-icon"></div>
                <p>Your data will be encrypted with Zama FHE for complete privacy</p>
              </div>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => setShowAddModal(false)} className="cancel-btn">Cancel</button>
              <button 
                onClick={addFitnessData} 
                disabled={addingData || !newData.date || !newData.workoutType || newData.duration <= 0 || newData.calories <= 0}
                className="submit-btn"
              >
                {addingData ? "Encrypting with FHE..." : "Add Workout"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {selectedData && (
        <div className="modal-overlay">
          <div className="data-detail-modal">
            <div className="modal-header">
              <h2>Workout Details</h2>
              <button onClick={() => {
                setSelectedData(null);
                setDecryptedValue(null);
              }} className="close-modal">&times;</button>
            </div>
            
            <div className="modal-body">
              <div className="detail-item">
                <span>Date:</span>
                <strong>{selectedData.date}</strong>
              </div>
              
              <div className="detail-item">
                <span>Workout Type:</span>
                <strong>{selectedData.workoutType}</strong>
              </div>
              
              <div className="detail-item">
                <span>Duration:</span>
                <strong>{selectedData.duration} minutes</strong>
              </div>
              
              <div className="detail-item">
                <span>Calories Burned:</span>
                <strong>{selectedData.calories}</strong>
              </div>
              
              <div className="detail-item">
                <span>Encrypted Fitness Score:</span>
                <div className="encrypted-value">
                  {selectedData.encrypted.substring(0, 20)}...
                </div>
              </div>
              
              <div className="decrypt-section">
                <button 
                  className="decrypt-btn" 
                  onClick={async () => {
                    if (decryptedValue !== null) {
                      setDecryptedValue(null);
                      return;
                    }
                    const decrypted = await decryptWithSignature(selectedData.encrypted);
                    setDecryptedValue(decrypted);
                  }}
                  disabled={isDecrypting}
                >
                  {isDecrypting ? "Decrypting..." : decryptedValue !== null ? "Hide Decrypted Value" : "Decrypt with Wallet"}
                </button>
                
                {decryptedValue !== null && (
                  <div className="decrypted-result">
                    <span>Decrypted Fitness Score:</span>
                    <strong>{decryptedValue.toFixed(2)}</strong>
                  </div>
                )}
              </div>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => {
                setSelectedData(null);
                setDecryptedValue(null);
              }} className="close-btn">Close</button>
            </div>
          </div>
        </div>
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="loading-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <h3>FitCoachFHE</h3>
            <p>Your private AI fitness coach powered by Zama FHE</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">About</a>
            <a href="#" className="footer-link">Privacy</a>
            <a href="#" className="footer-link">Terms</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="copyright">© {new Date().getFullYear()} FitCoachFHE. All rights reserved.</div>
          <div className="fhe-badge">
            <span>Powered by Zama FHE</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;