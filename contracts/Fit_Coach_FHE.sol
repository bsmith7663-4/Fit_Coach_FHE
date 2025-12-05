pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract FitCoachFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public isProvider;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    uint256 public currentBatchId;
    bool public batchOpen;

    struct EncryptedUserData {
        euint32 age;
        euint32 weight;
        euint32 height;
        euint32 fitnessGoal; // e.g., 1: weight loss, 2: muscle gain, 3: endurance
        euint32 activityLevel; // e.g., 1: sedentary, 2: lightly active, 3: moderately active, 4: very active
    }
    mapping(uint256 => mapping(address => EncryptedUserData)) public userEncryptedData;

    struct EncryptedPlan {
        euint32 targetCalories;
        euint32 targetProtein;
        euint32 targetCarbs;
        euint32 targetFat;
        euint32 workoutIntensity; // e.g., 1: low, 2: medium, 3: high
        euint32 workoutDurationMinutes;
    }
    mapping(uint256 => mapping(address => EncryptedPlan)) public userEncryptedPlan;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event ContractPaused(address indexed account);
    event ContractUnpaused(address indexed account);
    event CooldownSecondsUpdated(uint256 indexed oldCooldown, uint256 indexed newCooldown);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event UserDataSubmitted(address indexed user, uint256 indexed batchId);
    event PlanGenerationRequested(uint256 indexed requestId, address indexed user, uint256 indexed batchId);
    event PlanGenerationCompleted(uint256 indexed requestId, address indexed user, uint256 indexed batchId, uint256 targetCalories, uint256 targetProtein, uint256 targetCarbs, uint256 targetFat, uint256 workoutIntensity, uint256 workoutDurationMinutes);

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchNotOpen();
    error ReplayDetected();
    error StateMismatch();
    error InvalidCooldown();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
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
        emit ProviderAdded(owner);
        cooldownSeconds = 60; // Default 1 minute cooldown
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "New owner is the zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
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

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit ContractPaused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit ContractUnpaused(msg.sender);
    }

    function setCooldownSeconds(uint256 newCooldownSeconds) external onlyOwner {
        if (newCooldownSeconds == 0) revert InvalidCooldown();
        emit CooldownSecondsUpdated(cooldownSeconds, newCooldownSeconds);
        cooldownSeconds = newCooldownSeconds;
    }

    function openBatch() external onlyOwner whenNotPaused {
        currentBatchId++;
        batchOpen = true;
        emit BatchOpened(currentBatchId);
    }

    function closeBatch() external onlyOwner whenNotPaused {
        batchOpen = false;
        emit BatchClosed(currentBatchId);
    }

    function submitUserData(
        euint32 _age,
        euint32 _weight,
        euint32 _height,
        euint32 _fitnessGoal,
        euint32 _activityLevel
    ) external whenNotPaused checkSubmissionCooldown {
        if (!batchOpen) revert BatchNotOpen();
        lastSubmissionTime[msg.sender] = block.timestamp;

        userEncryptedData[currentBatchId][msg.sender] = EncryptedUserData({
            age: _age,
            weight: _weight,
            height: _height,
            fitnessGoal: _fitnessGoal,
            activityLevel: _activityLevel
        });
        emit UserDataSubmitted(msg.sender, currentBatchId);
    }

    function generatePersonalizedPlan(address user) external onlyProvider whenNotPaused checkDecryptionCooldown {
        if (!batchOpen) revert BatchNotOpen();
        lastDecryptionRequestTime[msg.sender] = block.timestamp;

        EncryptedUserData memory data = userEncryptedData[currentBatchId][user];
        _initIfNeeded(data.age);
        _initIfNeeded(data.weight);
        _initIfNeeded(data.height);
        _initIfNeeded(data.fitnessGoal);
        _initIfNeeded(data.activityLevel);

        // Placeholder FHE logic for plan generation
        // In a real scenario, this would be more complex AI-driven logic
        euint32 memory targetCalories = data.weight.mul(FHE.asEuint32(30)); // Example: 30 calories per kg of body weight
        euint32 memory targetProtein = data.weight.mul(FHE.asEuint32(2)); // Example: 2g of protein per kg of body weight
        euint32 memory targetCarbs = targetCalories.mul(FHE.asEuint32(50)).div(FHE.asEuint32(100)); // Example: 50% of calories from carbs
        euint32 memory targetFat = targetCalories.mul(FHE.asEuint32(30)).div(FHE.asEuint32(100)); // Example: 30% of calories from fat
        euint32 memory workoutIntensity = FHE.asEuint32(2); // Default medium intensity
        euint32 memory workoutDurationMinutes = FHE.asEuint32(45); // Default 45 minutes

        userEncryptedPlan[currentBatchId][user] = EncryptedPlan({
            targetCalories: targetCalories,
            targetProtein: targetProtein,
            targetCarbs: targetCarbs,
            targetFat: targetFat,
            workoutIntensity: workoutIntensity,
            workoutDurationMinutes: workoutDurationMinutes
        });

        bytes32[] memory cts = new bytes32[](6);
        cts[0] = targetCalories.toBytes32();
        cts[1] = targetProtein.toBytes32();
        cts[2] = targetCarbs.toBytes32();
        cts[3] = targetFat.toBytes32();
        cts[4] = workoutIntensity.toBytes32();
        cts[5] = workoutDurationMinutes.toBytes32();

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({
            batchId: currentBatchId,
            stateHash: stateHash,
            processed: false
        });

        emit PlanGenerationRequested(requestId, user, currentBatchId);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayDetected();

        // Rebuild cts from storage in the same order as during request
        EncryptedPlan memory plan = userEncryptedPlan[decryptionContexts[requestId].batchId][msg.sender];
        bytes32[] memory cts = new bytes32[](6);
        cts[0] = plan.targetCalories.toBytes32();
        cts[1] = plan.targetProtein.toBytes32();
        cts[2] = plan.targetCarbs.toBytes32();
        cts[3] = plan.targetFat.toBytes32();
        cts[4] = plan.workoutIntensity.toBytes32();
        cts[5] = plan.workoutDurationMinutes.toBytes32();

        bytes32 currentHash = _hashCiphertexts(cts);
        if (currentHash != decryptionContexts[requestId].stateHash) revert StateMismatch();

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint256 targetCalories = abi.decode(cleartexts[0:32], (uint256));
        uint256 targetProtein = abi.decode(cleartexts[32:64], (uint256));
        uint256 targetCarbs = abi.decode(cleartexts[64:96], (uint256));
        uint256 targetFat = abi.decode(cleartexts[96:128], (uint256));
        uint256 workoutIntensity = abi.decode(cleartexts[128:160], (uint256));
        uint256 workoutDurationMinutes = abi.decode(cleartexts[160:192], (uint256));

        decryptionContexts[requestId].processed = true;
        emit PlanGenerationCompleted(requestId, msg.sender, decryptionContexts[requestId].batchId, targetCalories, targetProtein, targetCarbs, targetFat, workoutIntensity, workoutDurationMinutes);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 val) internal {
        if (!val.isInitialized()) {
            val.init();
        }
    }

    function _requireInitialized(euint32 val) internal view {
        if (!val.isInitialized()) {
            revert("Value not initialized");
        }
    }
}