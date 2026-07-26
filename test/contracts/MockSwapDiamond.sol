// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockSwapDiamond {
    using SafeERC20 for IERC20;

    receive() external payable {}

    function swapETHForToken(address token, uint256 amountOut) external payable {
        require(msg.value > 0, "payment required");
        IERC20(token).safeTransfer(msg.sender, amountOut);
    }

    function swapTokenForETH(address token, uint256 amountIn, uint256 amountOut) external {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amountIn);
        (bool ok,) = payable(msg.sender).call{value: amountOut}("");
        require(ok, "ETH transfer failed");
    }
}
