// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title ATLAS Mainnet Index Token
/// @notice A non-custodial basket. Minting requires the caller to deposit every
///         canonical underlying token; burning returns the deterministic basket.
contract MainnetIndexToken is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_FEE_BPS = 500;

    address[] private _stocks;
    uint256[] private _weights;
    uint8[] private _stockDecimals;

    address public immutable creator;
    address public immutable treasury;
    address public immutable factory;
    uint256 public immutable feeBps;

    event IndexMinted(address indexed account, uint256 grossAmount, uint256 userAmount, uint256 feeAmount);
    event IndexBurned(address indexed account, uint256 amount);

    constructor(
        string memory name_,
        string memory symbol_,
        address[] memory stocks_,
        uint256[] memory weights_,
        address creator_,
        uint256 feeBps_,
        address treasury_
    ) ERC20(name_, symbol_) {
        require(bytes(name_).length > 0 && bytes(symbol_).length > 0, "name and symbol required");
        require(stocks_.length >= 2 && stocks_.length <= 5, "2-5 stocks");
        require(stocks_.length == weights_.length, "length mismatch");
        require(creator_ != address(0) && treasury_ != address(0), "zero role");
        require(feeBps_ <= MAX_FEE_BPS, "fee max 5%");

        uint256 totalWeight;
        for (uint256 i; i < stocks_.length; ++i) {
            require(stocks_[i] != address(0) && weights_[i] > 0, "invalid component");
            for (uint256 j; j < i; ++j) require(stocks_[j] != stocks_[i], "duplicate stock");
            uint8 tokenDecimals = IERC20Metadata(stocks_[i]).decimals();
            require(tokenDecimals <= 36, "unsupported decimals");
            _stocks.push(stocks_[i]);
            _weights.push(weights_[i]);
            _stockDecimals.push(tokenDecimals);
            totalWeight += weights_[i];
        }
        require(totalWeight == BPS, "weights must sum to 10000");

        creator = creator_;
        treasury = treasury_;
        factory = msg.sender;
        feeBps = feeBps_;
    }

    function mint(uint256 amount) external nonReentrant returns (uint256 userAmount) {
        require(amount > 0, "zero amount");
        for (uint256 i; i < _stocks.length; ++i) {
            IERC20 token = IERC20(_stocks[i]);
            uint256 requiredAmount = requiredUnderlying(i, amount);
            require(requiredAmount > 0, "amount too small");
            uint256 beforeBalance = token.balanceOf(address(this));
            token.safeTransferFrom(msg.sender, address(this), requiredAmount);
            require(token.balanceOf(address(this)) - beforeBalance == requiredAmount, "unsupported transfer fee");
        }

        uint256 fee = (amount * feeBps) / BPS;
        userAmount = amount - fee;
        uint256 creatorFee = fee / 2;
        uint256 treasuryFee = fee - creatorFee;

        _mint(msg.sender, userAmount);
        if (creatorFee > 0) _mint(creator, creatorFee);
        if (treasuryFee > 0) _mint(treasury, treasuryFee);
        emit IndexMinted(msg.sender, amount, userAmount, fee);
    }

    function burn(uint256 amount) external nonReentrant {
        require(amount > 0, "zero amount");
        _burn(msg.sender, amount);
        for (uint256 i; i < _stocks.length; ++i) {
            IERC20 token = IERC20(_stocks[i]);
            uint256 underlyingAmount = redeemUnderlying(i, amount);
            if (underlyingAmount > 0) token.safeTransfer(msg.sender, underlyingAmount);
        }
        emit IndexBurned(msg.sender, amount);
    }

    function requiredUnderlying(uint256 component, uint256 indexAmount) public view returns (uint256) {
        return _underlyingAmount(component, indexAmount, Math.Rounding.Ceil);
    }

    function redeemUnderlying(uint256 component, uint256 indexAmount) public view returns (uint256) {
        return _underlyingAmount(component, indexAmount, Math.Rounding.Floor);
    }

    function surplusUnderlying(uint256 component) external view returns (uint256) {
        require(component < _stocks.length, "component out of bounds");
        uint256 requiredBacking = requiredUnderlying(component, totalSupply());
        uint256 balance = IERC20(_stocks[component]).balanceOf(address(this));
        return balance > requiredBacking ? balance - requiredBacking : 0;
    }

    function _underlyingAmount(uint256 component, uint256 indexAmount, Math.Rounding rounding)
        private
        view
        returns (uint256)
    {
        require(component < _stocks.length, "component out of bounds");
        uint8 tokenDecimals = _stockDecimals[component];
        uint256 weight = _weights[component];
        if (tokenDecimals < 18) {
            return Math.mulDiv(indexAmount, weight, BPS * (10 ** (18 - tokenDecimals)), rounding);
        }
        if (tokenDecimals > 18) {
            return Math.mulDiv(indexAmount, weight * (10 ** (tokenDecimals - 18)), BPS, rounding);
        }
        return Math.mulDiv(indexAmount, weight, BPS, rounding);
    }

    function previewMint(uint256 amount) external view returns (uint256 userAmount, uint256 creatorFee, uint256 treasuryFee) {
        uint256 fee = (amount * feeBps) / BPS;
        userAmount = amount - fee;
        creatorFee = fee / 2;
        treasuryFee = fee - creatorFee;
    }

    function getStocks() external view returns (address[] memory) { return _stocks; }
    function getWeights() external view returns (uint256[] memory) { return _weights; }
    function stockCount() external view returns (uint256) { return _stocks.length; }
    function stocks(uint256 index) external view returns (address) { return _stocks[index]; }
    function weights(uint256 index) external view returns (uint256) { return _weights[index]; }
}
