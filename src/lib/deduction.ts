import { formatSignedTaka, formatTaka } from "./money";

/**
 * The warning shown before money is taken out that leaves a member below zero.
 *
 * Taking money out is deliberately not capped at the balance: a refund can be
 * real even when the member already owes the mess. But it must never happen
 * silently, so this returns the sentence the manager has to agree to, or null
 * when the balance covers the withdrawal.
 */
export function deductionWarning(input: {
  memberName: string;
  balance: number;
  amount: number;
}): string | null {
  const { memberName, balance, amount } = input;
  const projected = balance - amount;
  if (projected >= 0) return null;

  if (balance < 0) {
    return `${memberName}'s balance is already ${formatSignedTaka(
      balance,
    )}. Taking out ${formatTaka(amount)} will make it ${formatSignedTaka(
      projected,
    )}. Are you sure you want to take the money out?`;
  }

  return `${memberName} has only ${formatTaka(
    balance,
  )} in hand. Taking out ${formatTaka(
    amount,
  )} will put the balance at ${formatSignedTaka(
    projected,
  )}. Are you sure you want to take the money out?`;
}
