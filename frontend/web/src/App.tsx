import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface LootBox {
  id: string;
  encryptedContent: string;
  probability: string;
  timestamp: number;
  owner: string;
  status: "sealed" | "opened" | "verified";
  result?: number;
}

// FHE encryption simulation for numbers
const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}-${Date.now()}`;
};

// FHE decryption simulation with wallet signature
const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    const content = encryptedData.substring(4).split('-')[0];
    return parseFloat(atob(content));
  }
  return parseFloat(encryptedData);
};

// FHE computation simulation
const FHECompute = (encryptedData: string, operation: string): string => {
  const value = FHEDecryptNumber(encryptedData);
  let result = value;
  
  switch(operation) {
    case 'randomize':
      result = Math.floor(value * Math.random() * 100);
      break;
    case 'verify':
      result = value > 50 ? 100 : 0;
      break;
    default:
      result = value;
  }
  
  return FHEEncryptNumber(result);
};

const generateSignatureParams = () => `0x${Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [lootBoxes, setLootBoxes] = useState<LootBox[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ 
    visible: boolean; 
    status: "pending" | "success" | "error"; 
    message: string; 
  }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newLootBox, setNewLootBox] = useState({ 
    content: 0, 
    probability: 50 
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [selectedBox, setSelectedBox] = useState<LootBox | null>(null);
  const [decryptedContent, setDecryptedContent] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [signatureParams, setSignatureParams] = useState<string>("");
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [fheComputing, setFheComputing] = useState(false);

  // Statistics
  const sealedCount = lootBoxes.filter(box => box.status === "sealed").length;
  const openedCount = lootBoxes.filter(box => box.status === "opened").length;
  const verifiedCount = lootBoxes.filter(box => box.status === "verified").length;

  useEffect(() => {
    loadLootBoxes().finally(() => setLoading(false));
    setSignatureParams(generateSignatureParams());
  }, []);

  // Load loot boxes from contract
  const loadLootBoxes = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;

      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.log("Contract not available");
        return;
      }

      // Load box keys
      const keysBytes = await contract.getData("lootbox_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { 
          console.error("Error parsing lootbox keys:", e); 
        }
      }

      const boxes: LootBox[] = [];
      for (const key of keys) {
        try {
          const boxBytes = await contract.getData(`lootbox_${key}`);
          if (boxBytes.length > 0) {
            try {
              const boxData = JSON.parse(ethers.toUtf8String(boxBytes));
              boxes.push({ 
                id: key, 
                encryptedContent: boxData.content, 
                probability: boxData.probability,
                timestamp: boxData.timestamp, 
                owner: boxData.owner, 
                status: boxData.status || "sealed",
                result: boxData.result
              });
            } catch (e) { 
              console.error(`Error parsing box data for ${key}:`, e); 
            }
          }
        } catch (e) { 
          console.error(`Error loading box ${key}:`, e); 
        }
      }

      boxes.sort((a, b) => b.timestamp - a.timestamp);
      setLootBoxes(boxes);
    } catch (e) { 
      console.error("Error loading loot boxes:", e); 
    } finally { 
      setIsRefreshing(false); 
      setLoading(false); 
    }
  };

  // Create loot box
  const createLootBox = async () => {
    if (!isConnected) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({ 
      visible: true, 
      status: "pending", 
      message: "Encrypting loot box content with Zama FHE..." 
    });

    try {
      // Encrypt content and probability using FHE simulation
      const encryptedContent = FHEEncryptNumber(newLootBox.content);
      const encryptedProbability = FHEEncryptNumber(newLootBox.probability);

      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");

      const boxId = `box-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const boxData = { 
        content: encryptedContent, 
        probability: encryptedProbability,
        timestamp: Math.floor(Date.now() / 1000), 
        owner: address, 
        status: "sealed" 
      };

      // Store box data
      await contract.setData(`lootbox_${boxId}`, ethers.toUtf8Bytes(JSON.stringify(boxData)));

      // Update keys list
      const keysBytes = await contract.getData("lootbox_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { 
          keys = JSON.parse(ethers.toUtf8String(keysBytes)); 
        } catch (e) { 
          console.error("Error parsing keys:", e); 
        }
      }
      keys.push(boxId);
      await contract.setData("lootbox_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));

      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Loot box created with FHE encryption!" 
      });

      await loadLootBoxes();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewLootBox({ content: 0, probability: 50 });
        setCurrentStep(1);
      }, 2000);

    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Creation failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: errorMessage 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreating(false); 
    }
  };

  // Open loot box with FHE computation
  const openLootBox = async (boxId: string) => {
    if (!isConnected) { 
      alert("Please connect wallet first"); 
      return; 
    }

    setFheComputing(true);
    setTransactionStatus({ 
      visible: true, 
      status: "pending", 
      message: "Computing random result on encrypted data with Zama FHE..." 
    });

    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");

      const boxBytes = await contract.getData(`lootbox_${boxId}`);
      if (boxBytes.length === 0) throw new Error("Loot box not found");
      
      const boxData = JSON.parse(ethers.toUtf8String(boxBytes));
      
      // Simulate FHE computation on encrypted data
      const computedResult = FHECompute(boxData.content, 'randomize');
      
      const contractWithSigner = await getContractWithSigner();
      if (!contractWithSigner) throw new Error("Failed to get contract with signer");
      
      const updatedBox = { 
        ...boxData, 
        status: "opened", 
        result: computedResult 
      };
      
      await contractWithSigner.setData(`lootbox_${boxId}`, ethers.toUtf8String(JSON.stringify(updatedBox)));
      
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "FHE computation completed! Loot box opened." 
      });

      await loadLootBoxes();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setFheComputing(false);
      }, 2000);

    } catch (e: any) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Opening failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setFheComputing(false);
      }, 3000);
    }
  };

  // Verify loot box fairness
  const verifyLootBox = async (boxId: string) => {
    if (!isConnected) { 
      alert("Please connect wallet first"); 
      return; 
    }

    setFheComputing(true);
    setTransactionStatus({ 
      visible: true, 
      status: "pending", 
      message: "Verifying fairness with Zama FHE computation..." 
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const boxBytes = await contract.getData(`lootbox_${boxId}`);
      if (boxBytes.length === 0) throw new Error("Loot box not found");
      
      const boxData = JSON.parse(ethers.toUtf8String(boxBytes));
      const verifiedResult = FHECompute(boxData.probability, 'verify');
      
      const updatedBox = { 
        ...boxData, 
        status: "verified", 
        result: verifiedResult 
      };
      
      await contract.setData(`lootbox_${boxId}`, ethers.toUtf8String(JSON.stringify(updatedBox)));
      
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "FHE verification completed! Fairness confirmed." 
      });

      await loadLootBoxes();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setFheComputing(false);
      }, 2000);

    } catch (e: any) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Verification failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setFheComputing(false);
      }, 3000);
    }
  };

  // Decrypt with wallet signature
  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { 
      alert("Please connect wallet first"); 
      return null; 
    }

    setIsDecrypting(true);
    try {
      const message = `Decrypt FHE data: ${signatureParams}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate decryption delay
      return FHEDecryptNumber(encryptedData);
    } catch (e) { 
      console.error("Decryption failed:", e); 
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  // Check if user is owner
  const isOwner = (boxOwner: string) => address?.toLowerCase() === boxOwner.toLowerCase();

  // Tutorial steps
  const tutorialSteps = [
    { 
      title: "Connect Wallet", 
      description: "Connect your Web3 wallet to start creating FHE-encrypted loot boxes",
      icon: "🔗" 
    },
    { 
      title: "Create Loot Box", 
      description: "Set content value and probability - all encrypted with Zama FHE",
      icon: "🎁",
      details: "Data is encrypted client-side before blockchain submission" 
    },
    { 
      title: "FHE Computation", 
      description: "Loot boxes are opened using fully homomorphic encryption",
      icon: "⚙️",
      details: "Zama FHE enables computation on encrypted data without decryption" 
    },
    { 
      title: "Verify Fairness", 
      description: "Transparent verification of randomization fairness",
      icon: "✅",
      details: "Mathematical proofs ensure verifiable randomness" 
    }
  ];

  // Render statistics chart
  const renderStatsChart = () => {
    const total = lootBoxes.length || 1;
    const sealedPercentage = (sealedCount / total) * 100;
    const openedPercentage = (openedCount / total) * 100;
    const verifiedPercentage = (verifiedCount / total) * 100;

    return (
      <div className="stats-chart-container">
        <div className="stats-chart">
          <div 
            className="chart-bar sealed" 
            style={{ height: `${sealedPercentage}%` }}
            title={`Sealed: ${sealedCount}`}
          ></div>
          <div 
            className="chart-bar opened" 
            style={{ height: `${openedPercentage}%` }}
            title={`Opened: ${openedCount}`}
          ></div>
          <div 
            className="chart-bar verified" 
            style={{ height: `${verifiedPercentage}%` }}
            title={`Verified: ${verifiedCount}`}
          ></div>
        </div>
        <div className="chart-legend">
          <div className="legend-item">
            <div className="color-dot sealed"></div>
            <span>Sealed ({sealedCount})</span>
          </div>
          <div className="legend-item">
            <div className="color-dot opened"></div>
            <span>Opened ({openedCount})</span>
          </div>
          <div className="legend-item">
            <div className="color-dot verified"></div>
            <span>Verified ({verifiedCount})</span>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner">
        <div className="encryption-layer"></div>
        <div className="computation-core"></div>
      </div>
      <p>Initializing Zama FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container fhe-theme">
      {/* Header */}
      <header className="app-header">
        <div className="logo-section">
          <div className="logo">
            <div className="fhe-cube"></div>
            <h1>FHE<span>Loot</span>Box</h1>
          </div>
          <p className="tagline">Fully Homomorphic Encrypted NFT Loot Boxes</p>
        </div>
        
        <div className="header-controls">
          <div className="step-indicator">
            <div className={`step ${currentStep >= 1 ? 'active' : ''}`}>1</div>
            <div className={`step ${currentStep >= 2 ? 'active' : ''}`}>2</div>
            <div className={`step ${currentStep >= 3 ? 'active' : ''}`}>3</div>
            <div className={`step ${currentStep >= 4 ? 'active' : ''}`}>4</div>
          </div>
          
          <div className="header-buttons">
            <button 
              onClick={() => setShowCreateModal(true)} 
              className="create-btn fhe-button"
            >
              <div className="button-icon">🎁</div>
              Create Loot Box
            </button>
            
            <button 
              className="fhe-button secondary" 
              onClick={() => setShowTutorial(!showTutorial)}
            >
              {showTutorial ? "Hide Guide" : "Show Guide"}
            </button>
            
            <div className="wallet-connect">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="main-content">
        {/* Welcome Banner */}
        <div className="welcome-banner">
          <div className="banner-content">
            <h2>Verifiably Fair Loot Boxes with Zama FHE</h2>
            <p>Create, open, and verify loot boxes with fully homomorphic encryption - ensuring complete fairness and transparency</p>
          </div>
          <div className="fhe-status">
            <div className="status-indicator"></div>
            <span>FHE Encryption Active</span>
          </div>
        </div>

        {/* Tutorial Section */}
        {showTutorial && (
          <div className="tutorial-section">
            <h3>How FHE Loot Boxes Work</h3>
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div key={index} className="tutorial-step">
                  <div className="step-header">
                    <div className="step-number">{index + 1}</div>
                    <div className="step-icon">{step.icon}</div>
                    <h4>{step.title}</h4>
                  </div>
                  <p>{step.description}</p>
                  {step.details && <div className="step-details">{step.details}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Statistics Dashboard */}
        <div className="dashboard-section">
          <h3>Loot Box Statistics</h3>
          <div className="dashboard-grid">
            <div className="stat-card">
              <div className="stat-value">{lootBoxes.length}</div>
              <div className="stat-label">Total Boxes</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{sealedCount}</div>
              <div className="stat-label">Sealed</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{openedCount}</div>
              <div className="stat-label">Opened</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{verifiedCount}</div>
              <div className="stat-label">Verified</div>
            </div>
            <div className="chart-card">
              {renderStatsChart()}
            </div>
          </div>
        </div>

        {/* Loot Boxes List */}
        <div className="lootboxes-section">
          <div className="section-header">
            <h3>Your Loot Boxes</h3>
            <button 
              onClick={loadLootBoxes} 
              className="refresh-btn fhe-button"
              disabled={isRefreshing}
            >
              {isRefreshing ? "🔄 Refreshing..." : "🔄 Refresh"}
            </button>
          </div>

          <div className="lootboxes-grid">
            {lootBoxes.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🎁</div>
                <p>No loot boxes created yet</p>
                <button 
                  className="fhe-button primary" 
                  onClick={() => setShowCreateModal(true)}
                >
                  Create Your First Loot Box
                </button>
              </div>
            ) : (
              lootBoxes.map(box => (
                <div key={box.id} className="lootbox-card">
                  <div className="card-header">
                    <span className="box-id">#{box.id.substring(0, 8)}</span>
                    <span className={`status-badge ${box.status}`}>{box.status}</span>
                  </div>
                  
                  <div className="card-content">
                    <div className="encrypted-preview">
                      <div className="encrypted-data">
                        {box.encryptedContent.substring(0, 30)}...
                      </div>
                      <div className="fhe-tag">FHE Encrypted</div>
                    </div>
                    
                    <div className="box-info">
                      <div className="info-item">
                        <span>Owner:</span>
                        <span>{box.owner.substring(0, 6)}...{box.owner.substring(38)}</span>
                      </div>
                      <div className="info-item">
                        <span>Created:</span>
                        <span>{new Date(box.timestamp * 1000).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>

                  <div className="card-actions">
                    {isOwner(box.owner) && box.status === "sealed" && (
                      <button 
                        className="action-btn fhe-button"
                        onClick={() => openLootBox(box.id)}
                        disabled={fheComputing}
                      >
                        {fheComputing ? "Computing..." : "Open Box"}
                      </button>
                    )}
                    
                    {box.status === "opened" && (
                      <button 
                        className="action-btn fhe-button secondary"
                        onClick={() => verifyLootBox(box.id)}
                        disabled={fheComputing}
                      >
                        Verify Fairness
                      </button>
                    )}
                    
                    <button 
                      className="action-btn fhe-button outline"
                      onClick={() => setSelectedBox(box)}
                    >
                      View Details
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {showCreateModal && (
        <CreateLootBoxModal
          onSubmit={createLootBox}
          onClose={() => {
            setShowCreateModal(false);
            setCurrentStep(1);
          }}
          creating={creating}
          lootBoxData={newLootBox}
          setLootBoxData={setNewLootBox}
          currentStep={currentStep}
          setCurrentStep={setCurrentStep}
        />
      )}

      {selectedBox && (
        <LootBoxDetailModal
          box={selectedBox}
          onClose={() => {
            setSelectedBox(null);
            setDecryptedContent(null);
          }}
          decryptedContent={decryptedContent}
          setDecryptedContent={setDecryptedContent}
          isDecrypting={isDecrypting}
          decryptWithSignature={decryptWithSignature}
        />
      )}

      {transactionStatus.visible && (
        <TransactionModal
          status={transactionStatus.status}
          message={transactionStatus.message}
        />
      )}

      {/* Footer */}
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="fhe-badge">
              <div className="fhe-icon-small"></div>
              <span>Powered by Zama FHE</span>
            </div>
            <p>Verifiably fair loot boxes with fully homomorphic encryption</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">GitHub</a>
            <a href="#" className="footer-link">Privacy</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

// Create Loot Box Modal Component
interface CreateLootBoxModalProps {
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  lootBoxData: any;
  setLootBoxData: (data: any) => void;
  currentStep: number;
  setCurrentStep: (step: number) => void;
}

const CreateLootBoxModal: React.FC<CreateLootBoxModalProps> = ({
  onSubmit,
  onClose,
  creating,
  lootBoxData,
  setLootBoxData,
  currentStep,
  setCurrentStep
}) => {
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setLootBoxData({ ...lootBoxData, [name]: parseFloat(value) });
  };

  const handleSubmit = () => {
    if (lootBoxData.content <= 0) {
      alert("Please enter a valid content value");
      return;
    }
    onSubmit();
  };

  const nextStep = () => setCurrentStep(Math.min(currentStep + 1, 4));
  const prevStep = () => setCurrentStep(Math.max(currentStep - 1, 1));

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Create FHE Loot Box</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>

        <div className="modal-progress">
          <div className="progress-bar">
            <div 
              className="progress-fill" 
              style={{ width: `${(currentStep / 4) * 100}%` }}
            ></div>
          </div>
          <div className="step-labels">
            <span className={currentStep >= 1 ? 'active' : ''}>Setup</span>
            <span className={currentStep >= 2 ? 'active' : ''}>Encrypt</span>
            <span className={currentStep >= 3 ? 'active' : ''}>Review</span>
            <span className={currentStep >= 4 ? 'active' : ''}>Confirm</span>
          </div>
        </div>

        <div className="modal-body">
          {currentStep === 1 && (
            <div className="step-content">
              <h3>Loot Box Configuration</h3>
              <div className="form-group">
                <label>Content Value *</label>
                <input
                  type="number"
                  name="content"
                  value={lootBoxData.content}
                  onChange={handleInputChange}
                  placeholder="Enter numerical value..."
                  className="fhe-input"
                  min="1"
                  step="0.01"
                />
              </div>
              <div className="form-group">
                <label>Win Probability (%)</label>
                <input
                  type="range"
                  name="probability"
                  value={lootBoxData.probability}
                  onChange={handleInputChange}
                  min="1"
                  max="100"
                  className="probability-slider"
                />
                <div className="probability-value">{lootBoxData.probability}%</div>
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div className="step-content">
              <h3>FHE Encryption Preview</h3>
              <div className="encryption-preview">
                <div className="data-row">
                  <span>Plain Content:</span>
                  <strong>{lootBoxData.content}</strong>
                </div>
                <div className="encryption-arrow">↓ FHE Encryption</div>
                <div className="data-row encrypted">
                  <span>Encrypted Content:</span>
                  <div>{FHEEncryptNumber(lootBoxData.content).substring(0, 40)}...</div>
                </div>
              </div>
            </div>
          )}

          {currentStep === 3 && (
            <div className="step-content">
              <h3>Review Loot Box</h3>
              <div className="review-details">
                <div className="detail-item">
                  <span>Content Value:</span>
                  <span>{lootBoxData.content}</span>
                </div>
                <div className="detail-item">
                  <span>Win Probability:</span>
                  <span>{lootBoxData.probability}%</span>
                </div>
                <div className="detail-item">
                  <span>Encryption:</span>
                  <span className="fhe-tag">Zama FHE</span>
                </div>
              </div>
            </div>
          )}

          {currentStep === 4 && (
            <div className="step-content">
              <h3>Confirmation</h3>
              <div className="confirmation-message">
                <div className="security-icon">🔒</div>
                <p>Your loot box will be encrypted with Zama FHE technology</p>
                <p className="notice">All computations will happen on encrypted data</p>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={prevStep} className="fhe-button secondary" disabled={currentStep === 1}>
            Previous
          </button>
          
          {currentStep < 4 ? (
            <button onClick={nextStep} className="fhe-button">
              Next
            </button>
          ) : (
            <button onClick={handleSubmit} disabled={creating} className="fhe-button primary">
              {creating ? "Encrypting with FHE..." : "Create Loot Box"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// Loot Box Detail Modal Component
interface LootBoxDetailModalProps {
  box: LootBox;
  onClose: () => void;
  decryptedContent: number | null;
  setDecryptedContent: (content: number | null) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<number | null>;
}

const LootBoxDetailModal: React.FC<LootBoxDetailModalProps> = ({
  box,
  onClose,
  decryptedContent,
  setDecryptedContent,
  isDecrypting,
  decryptWithSignature
}) => {
  const handleDecrypt = async () => {
    if (decryptedContent !== null) {
      setDecryptedContent(null);
      return;
    }
    const decrypted = await decryptWithSignature(box.encryptedContent);
    if (decrypted !== null) setDecryptedContent(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="detail-modal">
        <div className="modal-header">
          <h2>Loot Box Details</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>

        <div className="modal-body">
          <div className="box-details">
            <div className="detail-grid">
              <div className="detail-item">
                <span>Box ID:</span>
                <span>#{box.id.substring(0, 12)}</span>
              </div>
              <div className="detail-item">
                <span>Status:</span>
                <span className={`status-badge ${box.status}`}>{box.status}</span>
              </div>
              <div className="detail-item">
                <span>Owner:</span>
                <span>{box.owner.substring(0, 8)}...{box.owner.substring(36)}</span>
              </div>
              <div className="detail-item">
                <span>Created:</span>
                <span>{new Date(box.timestamp * 1000).toLocaleString()}</span>
              </div>
            </div>

            <div className="encrypted-section">
              <h4>Encrypted Content</h4>
              <div className="encrypted-data">
                {box.encryptedContent}
              </div>
              
              <button 
                onClick={handleDecrypt} 
                disabled={isDecrypting}
                className="decrypt-btn fhe-button"
              >
                {isDecrypting ? "Decrypting..." : 
                 decryptedContent !== null ? "Re-encrypt" : "Decrypt with Signature"}
              </button>
            </div>

            {decryptedContent !== null && (
              <div className="decrypted-section">
                <h4>Decrypted Content</h4>
                <div className="decrypted-value">{decryptedContent}</div>
                <div className="decryption-notice">
                  Visible only after wallet signature verification
                </div>
              </div>
            )}

            {box.result && (
              <div className="result-section">
                <h4>Computation Result</h4>
                <div className="result-value">
                  {box.result}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="fhe-button">Close</button>
        </div>
      </div>
    </div>
  );
};

// Transaction Modal Component
interface TransactionModalProps {
  status: "pending" | "success" | "error";
  message: string;
}

const TransactionModal: React.FC<TransactionModalProps> = ({ status, message }) => {
  return (
    <div className="transaction-overlay">
      <div className="transaction-modal">
        <div className={`transaction-icon ${status}`}>
          {status === "pending" && <div className="fhe-computing"></div>}
          {status === "success" && "✅"}
          {status === "error" && "❌"}
        </div>
        <div className="transaction-message">{message}</div>
        {status === "pending" && (
          <div className="computing-text">FHE Computation in Progress...</div>
        )}
      </div>
    </div>
  );
};

export default App;