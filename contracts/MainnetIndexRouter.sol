// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IMainnetIndexToken is IERC20 {
    function getStocks() external view returns (address[] memory);
    function requiredUnderlying(uint256 component, uint256 indexAmount) external view returns (uint256);
    function mint(uint256 amount) external returns (uint256 userAmount);
    function burn(uint256 amount) external;
}

/// @title ATLAS Mainnet Index Router
/// @notice Converts native ETH to every component through a fixed LI.FI Diamond,
///         then atomically mints an ATLAS index. The reverse path burns an index
///         and converts its redeemed components to native ETH.
/// @dev Swap calldata is supplied by a quote service, but every call target is
///      fixed and final token/ETH deltas are verified. The router never relies on
///      persistent inventory and never transfers balances that predate a call.
contract MainnetIndexRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct SwapCall {
        address target;
        uint256 value;
        bytes data;
    }

    address public immutable lifiDiamond;

    event IndexBoughtWithETH(address indexed buyer, address indexed indexToken, uint256 ethSpent, uint256 grossAmount, uint256 userAmount);
    event IndexSoldForETH(address indexed seller, address indexed indexToken, uint256 indexAmount, uint256 ethAmount);

    constructor(address lifiDiamond_) {
        require(lifiDiamond_ != address(0) && lifiDiamond_.code.length > 0, "invalid LI.FI Diamond");
        lifiDiamond = lifiDiamond_;
    }

    receive() external payable {}

    function mintIndexWithETH(address indexToken, uint256 grossAmount, SwapCall[] calldata swaps)
        external
        payable
        nonReentrant
        returns (uint256 userAmount)
    {
        require(indexToken != address(0) && grossAmount > 0 && msg.value > 0, "invalid purchase");
        IMainnetIndexToken index = IMainnetIndexToken(indexToken);
        address[] memory stocks = index.getStocks();
        require(stocks.length >= 2 && stocks.length == swaps.length, "swap length mismatch");

        uint256 baselineETH = address(this).balance - msg.value;
        uint256[] memory baselines = new uint256[](stocks.length);
        uint256 totalSwapValue;

        for (uint256 i; i < stocks.length; ++i) {
            SwapCall calldata swap = swaps[i];
            totalSwapValue += swap.value;
            require(totalSwapValue <= msg.value, "swap value exceeds payment");
            baselines[i] = _buyComponent(indexToken, stocks[i], i, grossAmount, swap);
        }

        uint256 beforeIndex = index.balanceOf(address(this));
        for (uint256 i; i < stocks.length; ++i) {
            IERC20(stocks[i]).forceApprove(indexToken, index.requiredUnderlying(i, grossAmount));
        }
        index.mint(grossAmount);
        for (uint256 i; i < stocks.length; ++i) IERC20(stocks[i]).forceApprove(indexToken, 0);

        userAmount = index.balanceOf(address(this)) - beforeIndex;
        require(userAmount > 0, "no index output");
        IERC20(indexToken).safeTransfer(msg.sender, userAmount);

        for (uint256 i; i < stocks.length; ++i) {
            IERC20 stock = IERC20(stocks[i]);
            uint256 extra = stock.balanceOf(address(this)) - baselines[i];
            if (extra > 0) stock.safeTransfer(msg.sender, extra);
        }
        uint256 refund = address(this).balance - baselineETH;
        if (refund > 0) _sendETH(msg.sender, refund);
        emit IndexBoughtWithETH(msg.sender, indexToken, msg.value - refund, grossAmount, userAmount);
    }

    function sellIndexForETH(address indexToken, uint256 indexAmount, SwapCall[] calldata swaps, uint256 minimumETH)
        external
        nonReentrant
        returns (uint256 ethAmount)
    {
        require(indexToken != address(0) && indexAmount > 0 && minimumETH > 0, "invalid sale");
        IMainnetIndexToken index = IMainnetIndexToken(indexToken);
        address[] memory stocks = index.getStocks();
        require(stocks.length >= 2 && stocks.length == swaps.length, "swap length mismatch");

        uint256 baselineETH = address(this).balance;
        uint256[] memory baselines = new uint256[](stocks.length);
        for (uint256 i; i < stocks.length; ++i) baselines[i] = IERC20(stocks[i]).balanceOf(address(this));

        IERC20(indexToken).safeTransferFrom(msg.sender, address(this), indexAmount);
        index.burn(indexAmount);

        for (uint256 i; i < stocks.length; ++i) {
            IERC20 stock = IERC20(stocks[i]);
            uint256 redeemed = stock.balanceOf(address(this)) - baselines[i];
            require(redeemed > 0, "no redeemed component");
            SwapCall calldata swap = swaps[i];
            require(swap.target == lifiDiamond && swap.value == 0 && swap.data.length >= 4, "untrusted swap");
            stock.forceApprove(lifiDiamond, redeemed);
            (bool ok, bytes memory reason) = swap.target.call(swap.data);
            stock.forceApprove(lifiDiamond, 0);
            if (!ok) _bubble(reason);
            uint256 leftover = stock.balanceOf(address(this)) - baselines[i];
            if (leftover > 0) stock.safeTransfer(msg.sender, leftover);
        }

        ethAmount = address(this).balance - baselineETH;
        require(ethAmount >= minimumETH, "insufficient ETH output");
        _sendETH(msg.sender, ethAmount);
        emit IndexSoldForETH(msg.sender, indexToken, indexAmount, ethAmount);
    }

    function _buyComponent(address indexToken, address stockAddress, uint256 component, uint256 grossAmount, SwapCall calldata swap)
        private
        returns (uint256 baseline)
    {
        require(swap.target == lifiDiamond && swap.data.length >= 4, "untrusted swap");
        IERC20 stock = IERC20(stockAddress);
        baseline = stock.balanceOf(address(this));
        (bool ok, bytes memory reason) = swap.target.call{value: swap.value}(swap.data);
        if (!ok) _bubble(reason);
        require(
            stock.balanceOf(address(this)) - baseline >= IMainnetIndexToken(indexToken).requiredUnderlying(component, grossAmount),
            "insufficient component output"
        );
    }

    function _sendETH(address recipient, uint256 amount) private {
        (bool ok,) = payable(recipient).call{value: amount}("");
        require(ok, "ETH transfer failed");
    }

    function _bubble(bytes memory reason) private pure {
        if (reason.length == 0) revert("swap failed");
        assembly ("memory-safe") { revert(add(reason, 32), mload(reason)) }
    }
}
