// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {MainnetIndexToken} from "./MainnetIndexToken.sol";

interface IERC8056Multiplier {
    function uiMultiplier() external view returns (uint256);
}

/// @title ATLAS Mainnet Index Factory
/// @notice Deploys direct-mint baskets using only owner-approved canonical RWA tokens.
contract MainnetIndexFactory is Ownable2Step {
    address[] public allIndices;
    mapping(address => address[]) private _creatorIndices;
    mapping(address => bool) public isIndex;
    mapping(address => bool) public allowedStock;
    address public treasury;

    event IndexCreated(
        address indexed indexToken,
        string name,
        string symbol,
        address indexed creator,
        address[] stocks,
        uint256[] weights,
        uint256 feeBps
    );
    event StockAllowlistUpdated(address indexed stock, bool allowed);
    event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);

    constructor(address treasury_, address[] memory canonicalStocks) Ownable(msg.sender) {
        require(treasury_ != address(0), "treasury required");
        require(canonicalStocks.length > 0, "stocks required");
        treasury = treasury_;
        for (uint256 i; i < canonicalStocks.length; ++i) _setStockAllowed(canonicalStocks[i], true);
    }

    function createIndex(
        string memory name_,
        string memory symbol_,
        address[] memory stocks_,
        uint256[] memory weights_,
        uint256 feeBps_
    ) external returns (address indexAddress) {
        require(bytes(name_).length > 0 && bytes(symbol_).length > 0, "name and symbol required");
        require(stocks_.length >= 2 && stocks_.length <= 5, "2-5 stocks");
        require(stocks_.length == weights_.length, "length mismatch");

        uint256 totalWeight;
        for (uint256 i; i < stocks_.length; ++i) {
            require(allowedStock[stocks_[i]], "stock not allowed");
            require(weights_[i] > 0, "zero weight");
            for (uint256 j; j < i; ++j) require(stocks_[j] != stocks_[i], "duplicate stock");
            totalWeight += weights_[i];
        }
        require(totalWeight == 10_000, "weights must sum to 10000");
        require(feeBps_ <= 500, "fee max 5%");

        MainnetIndexToken indexToken = new MainnetIndexToken(
            name_, symbol_, stocks_, weights_, msg.sender, feeBps_, treasury
        );
        indexAddress = address(indexToken);
        allIndices.push(indexAddress);
        _creatorIndices[msg.sender].push(indexAddress);
        isIndex[indexAddress] = true;
        emit IndexCreated(indexAddress, name_, symbol_, msg.sender, stocks_, weights_, feeBps_);
    }

    function setStockAllowed(address stock, bool allowed) external onlyOwner {
        _setStockAllowed(stock, allowed);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "treasury required");
        address previousTreasury = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(previousTreasury, newTreasury);
    }

    function totalIndices() external view returns (uint256) { return allIndices.length; }
    function getCreatorIndices(address creator) external view returns (address[] memory) { return _creatorIndices[creator]; }

    function _setStockAllowed(address stock, bool allowed) internal {
        require(stock != address(0), "stock required");
        if (allowed) {
            require(stock.code.length > 0, "stock has no code");
            require(IERC20Metadata(stock).decimals() == 18, "stock decimals must be 18");
            require(IERC8056Multiplier(stock).uiMultiplier() > 0, "invalid ui multiplier");
        }
        allowedStock[stock] = allowed;
        emit StockAllowlistUpdated(stock, allowed);
    }
}
