pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract LootBoxNFTFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public isProvider;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;
    uint256 public cooldownSeconds;
    bool public paused;

    struct Batch {
        uint256 id;
        bool isOpen;
        euint32[] encryptedItemIds;
        euint32[] encryptedProbabilities;
        uint256 totalItems;
    }

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }

    mapping(uint256 => Batch) public batches;
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event CooldownSecondsUpdated(uint256 oldCooldown, uint256 newCooldown);
    event Paused(address account);
    event Unpaused(address account);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event LootBoxSubmitted(address indexed submitter, uint256 indexed batchId, uint256 itemIndex);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId);
    event LootBoxOpened(uint256 indexed requestId, uint256 indexed batchId, uint256[] itemIds, uint256[] probabilities, uint256 randomIndex);

    error NotOwner();
    error NotProvider();
    error PausedState();
    error CooldownActive();
    error InvalidBatch();
    error BatchNotOpen();
    error BatchClosed();
    error InvalidProbability();
    error ReplayAttempt();
    error StateMismatch();
    error InvalidProof();
    error NotInitialized();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert PausedState();
        _;
    }

    modifier checkSubmissionCooldown() {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    modifier checkDecryptionCooldown() {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        isProvider[owner] = true;
        cooldownSeconds = 60; 
        emit ProviderAdded(owner);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        if (!isProvider[provider]) {
            isProvider[provider] = true;
            emit ProviderAdded(provider);
        }
    }

    function removeProvider(address provider) external onlyOwner {
        if (isProvider[provider]) {
            isProvider[provider] = false;
            emit ProviderRemoved(provider);
        }
    }

    function setCooldownSeconds(uint256 newCooldownSeconds) external onlyOwner {
        uint256 oldCooldown = cooldownSeconds;
        cooldownSeconds = newCooldownSeconds;
        emit CooldownSecondsUpdated(oldCooldown, newCooldownSeconds);
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function openBatch() external onlyOwner whenNotPaused {
        uint256 batchId = batches[0].id + 1; 
        batches[batchId] = Batch({
            id: batchId,
            isOpen: true,
            encryptedItemIds: new euint32[](0),
            encryptedProbabilities: new euint32[](0),
            totalItems: 0
        });
        emit BatchOpened(batchId);
    }

    function closeBatch(uint256 batchId) external onlyOwner whenNotPaused {
        if (batchId == 0 || batches[batchId].id != batchId) revert InvalidBatch();
        if (!batches[batchId].isOpen) revert BatchClosed();
        batches[batchId].isOpen = false;
        emit BatchClosed(batchId);
    }

    function _initIfNeeded(euint32 storage item) internal {
        if (!item.isInitialized()) {
            item.init();
        }
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _requireInitialized(euint32 storage item) internal view {
        if (!item.isInitialized()) {
            revert NotInitialized();
        }
    }

    function _requireInitialized(ebool storage item) internal view {
        if (!item.isInitialized()) {
            revert NotInitialized();
        }
    }

    function submitLootBoxItem(
        uint256 batchId,
        euint32 memory encryptedItemId,
        euint32 memory encryptedProbability
    ) external onlyProvider whenNotPaused checkSubmissionCooldown {
        if (batchId == 0 || batches[batchId].id != batchId) revert InvalidBatch();
        if (!batches[batchId].isOpen) revert BatchNotOpen();

        euint32 sumProb;
        sumProb.init();
        for (uint i = 0; i < batches[batchId].encryptedProbabilities.length; i++) {
            sumProb = sumProb.add(batches[batchId].encryptedProbabilities[i]);
        }
        sumProb = sumProb.add(encryptedProbability);

        euint32 oneHundred;
        oneHundred.init(100);
        ebool validProb = sumProb.le(oneHundred);
        if (!validProb.isInitialized()) revert NotInitialized();
        if (!validProb.decrypt()) revert InvalidProbability();

        batches[batchId].encryptedItemIds.push(encryptedItemId);
        batches[batchId].encryptedProbabilities.push(encryptedProbability);
        batches[batchId].totalItems++;

        lastSubmissionTime[msg.sender] = block.timestamp;
        emit LootBoxSubmitted(msg.sender, batchId, batches[batchId].totalItems - 1);
    }

    function openLootBox(uint256 batchId) external whenNotPaused checkDecryptionCooldown {
        if (batchId == 0 || batches[batchId].id != batchId) revert InvalidBatch();
        if (batches[batchId].isOpen) revert BatchNotOpen();
        if (batches[batchId].totalItems == 0) revert InvalidBatch();

        euint32 random;
        random.init(block.timestamp); 

        euint32 accumulatedProb;
        accumulatedProb.init();
        euint32[] memory cts = new euint32[](batches[batchId].totalItems * 2 + 1);

        uint256 randomIndex;
        for (uint i = 0; i < batches[batchId].totalItems; i++) {
            _requireInitialized(batches[batchId].encryptedProbabilities[i]);
            accumulatedProb = accumulatedProb.add(batches[batchId].encryptedProbabilities[i]);
            ebool geResult = random.ge(accumulatedProb);
            _requireInitialized(geResult);

            if (geResult.decrypt()) {
                randomIndex = i;
            }
        }

        cts[0] = random;
        for (uint i = 0; i < batches[batchId].totalItems; i++) {
            cts[1 + i] = batches[batchId].encryptedItemIds[i];
            cts[1 + batches[batchId].totalItems + i] = batches[batchId].encryptedProbabilities[i];
        }

        bytes32 stateHash = _hashCiphertexts(FHE.toBytes32(cts));
        uint256 requestId = FHE.requestDecryption(FHE.toBytes32(cts), this.myCallback.selector);
        decryptionContexts[requestId] = DecryptionContext({
            batchId: batchId,
            stateHash: stateHash,
            processed: false
        });

        lastDecryptionRequestTime[msg.sender] = block.timestamp;
        emit DecryptionRequested(requestId, batchId);
    }

    function myCallback(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        if (decryptionContexts[requestId].processed) revert ReplayAttempt();

        uint256 batchId = decryptionContexts[requestId].batchId;
        if (batchId == 0 || batches[batchId].id != batchId) revert InvalidBatch();

        uint256 totalItems = batches[batchId].totalItems;
        uint256 expectedCleartextsLength = 32 * (1 + 2 * totalItems);
        if (cleartexts.length != expectedCleartextsLength) revert InvalidProof();

        euint32[] memory currentCts = new euint32[](1 + 2 * totalItems);
        currentCts[0] = euint32(FHE.asEuint32(abi.decode(cleartexts[:32], (bytes32)))); 

        for (uint i = 0; i < totalItems; i++) {
            currentCts[1 + i] = batches[batchId].encryptedItemIds[i];
            currentCts[1 + totalItems + i] = batches[batchId].encryptedProbabilities[i];
        }
        bytes32 currentHash = _hashCiphertexts(FHE.toBytes32(currentCts));

        if (currentHash != decryptionContexts[requestId].stateHash) revert StateMismatch();

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint256 randomValue = abi.decode(cleartexts[:32], (uint256));
        uint256[] memory itemIds = new uint256[](totalItems);
        uint256[] memory probabilities = new uint256[](totalItems);

        for (uint i = 0; i < totalItems; i++) {
            itemIds[i] = abi.decode(cleartexts[32 + 32 * i:64 + 32 * i], (uint256));
            probabilities[i] = abi.decode(cleartexts[32 + 32 * totalItems + 32 * i:64 + 32 * totalItems + 32 * i], (uint256));
        }
        
        uint256 accumulatedProb;
        uint256 randomIndex;
        for (uint i = 0; i < totalItems; i++) {
            accumulatedProb += probabilities[i];
            if (randomValue >= accumulatedProb) {
                randomIndex = i;
            }
        }

        decryptionContexts[requestId].processed = true;
        emit LootBoxOpened(requestId, batchId, itemIds, probabilities, randomIndex);
    }
}