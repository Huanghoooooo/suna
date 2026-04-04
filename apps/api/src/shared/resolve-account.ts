import { eq } from 'drizzle-orm';
import { accounts, accountMembers, accountUser, billingCustomers, creditAccounts } from '@kortix/db';
import { db } from './db';

async function syncLegacySubscription(accountId: string): Promise<void> {
  const [existing] = await db
    .select({ tier: creditAccounts.tier })
    .from(creditAccounts)
    .where(eq(creditAccounts.accountId, accountId))
    .limit(1);

  if (existing?.tier && existing.tier !== 'free' && existing.tier !== 'none') return;

  let customerEmail: string | null = null;
  try {
    const [customer] = await db
      .select({ email: billingCustomers.email })
      .from(billingCustomers)
      .where(eq(billingCustomers.accountId, accountId))
      .limit(1);
    customerEmail = customer?.email ?? null;
  } catch { }

  if (!customerEmail) return;

  try {
    const { getStripe } = await import('./stripe');
    const stripe = getStripe();
    const { getTierByPriceId } = await import('../billing/services/tiers');

    const customers = await stripe.customers.search({
      query: `email:'${customerEmail}'`,
      limit: 10,
    });

    for (const customer of customers.data) {
      const subs = await stripe.subscriptions.list({
        customer: customer.id,
        status: 'active',
        limit: 5,
      });

      for (const sub of subs.data) {
        const priceId = sub.items.data[0]?.price?.id;
        if (!priceId) continue;

        const tierConfig = getTierByPriceId(priceId);
        if (!tierConfig || tierConfig.name === 'free' || tierConfig.name === 'none') continue;
        const tier = tierConfig.name;

        const { upsertCreditAccount } = await import('../billing/repositories/credit-accounts');
        await upsertCreditAccount(accountId, {
          tier,
          stripeSubscriptionId: sub.id,
          stripeSubscriptionStatus: sub.status,
        });

        await db.insert(billingCustomers).values({
          accountId,
          id: customer.id,
          email: customerEmail,
          active: true,
          provider: 'stripe',
        }).onConflictDoNothing();

        console.log(`[resolve-account] Synced Stripe sub ${sub.id} → tier=${tier} for ${accountId} (customer=${customer.id})`);
        return;
      }
    }
  } catch (err) {
    console.warn(`[resolve-account] Stripe sync error for ${accountId}:`, err);
  }
}

export async function resolveAccountId(userId: string): Promise<string> {
  try {
    const [membership] = await db
      .select({ accountId: accountMembers.accountId })
      .from(accountMembers)
      .where(eq(accountMembers.userId, userId))
      .limit(1);

    if (membership) return membership.accountId;
  } catch { }

  try {
    const [legacy] = await db
      .select({ accountId: accountUser.accountId })
      .from(accountUser)
      .where(eq(accountUser.userId, userId))
      .limit(1);

    if (legacy) {
      try {
        await db.insert(accounts).values({
          accountId: legacy.accountId,
          name: 'Personal',
          personalAccount: true,
        }).onConflictDoNothing();

        await db.insert(accountMembers).values({
          userId,
          accountId: legacy.accountId,
          accountRole: 'owner',
        }).onConflictDoNothing();

        console.log(`[resolve-account] Lazy-migrated basejump account ${legacy.accountId} for user ${userId}`);
      } catch (migErr) {
        console.warn(`[resolve-account] Lazy migration failed for ${legacy.accountId}:`, migErr);
      }

      syncLegacySubscription(legacy.accountId).catch((err) => {
        console.warn(`[resolve-account] Stripe sync failed for ${legacy.accountId}:`, err);
      });

      return legacy.accountId;
    }
  } catch { }

  try {
    await db.insert(accounts).values({
      accountId: userId,
      name: 'Personal',
      personalAccount: true,
    }).onConflictDoNothing();

    await db.insert(accountMembers).values({
      userId,
      accountId: userId,
      accountRole: 'owner',
    }).onConflictDoNothing();
  } catch { }

  return userId;
}
