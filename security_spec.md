# Security Specifications - Central Food Assistant

This document specifies the Data Invariants, the "Dirty Dozen" vulnerability payloads, and the Security Test runner for the Firestore security rules.

## 1. Data Invariants

1. **User Identity Invariant**: A user can only modify their own profile document (`/users/{userId}`). No user can spoof another user's identity.
2. **Privilege Isolation Invariant**: Users are strictly forbidden from modifying their own roles or privileges (e.g. updating `role` to `"admin"` or `"merchant"`) unless updated by an administrative actor.
3. **Relation Integrity Invariant**: If a user is registered as a `"merchant"`, they are only permitted to edit restaurant metadata in `/restaurants/{restaurantId}` if they own that restaurant (`owner_uid == userId`) or if they are a global administrator (`"admin"`).
4. **Relational Sync Invariant**: Subcollection menu items under `/restaurants/{restaurantId}/menu_items/{menuItemId}` can only be successfully added or written to if the parent restaurant entity exists.

---

## 2. The "Dirty Dozen" Malicious Payloads

Here are 12 malicious payloads meant to attack our Firestore database structure.

### 1. User Profile Identity Spoofing (Identity Attack)
- **Target Path**: `/users/legit_user_123`
- **Requestor Auth**: `some_attacker_456`
- **Payload**: `{ "username": "Spoof Hacker", "blacklist_ingredients": [] }`
- **Expected Outcome**: `PERMISSION_DENIED`

### 2. Self-Role Modification / Privilege Escalation (Privilege Attack)
- **Target Path**: `/users/regular_user_789`
- **Requestor Auth**: `regular_user_789`
- **Payload**: `{ "user_id": "regular_user_789", "email": "anybody@gmail.com", "username": "Hacker", "role": "admin" }`
- **Expected Outcome**: `PERMISSION_DENIED` (Cannot change role field)

### 3. Unauthorized Global Restaurant Creation (Write Gap Attack)
- **Target Path**: `/restaurants/999`
- **Requestor Auth**: `regular_user_789` (Normal User)
- **Payload**: `{ "restaurant_id": 999, "name": "Fake Food Place", "category": "速食" }`
- **Expected Outcome**: `PERMISSION_DENIED` (Regular user cannot create restaurants)

### 4. Spoofing Restaurant Ownership (Integrity Attack)
- **Target Path**: `/restaurants/123`
- **Requestor Auth**: `dish_washer_merchant_722` (Merchant)
- **Payload**: `{ "restaurant_id": 123, "name": "Hacked Restaurant", "owner_uid": "attacker_uid" }`
- **Expected Outcome**: `PERMISSION_DENIED` (Only original owner or admin can update, cannot assign unverified ownership)

### 5. Hijacking Menu Items Under Another Owner's Shop (Relational Attack)
- **Target Path**: `/restaurants/restaurant_owned_by_legit/menu_items/test_dish`
- **Requestor Auth**: `dish_washer_merchant_722` (Unauthorized Merchant)
- **Payload**: `{ "menu_id": 444, "item_name": "Junk dish", "price": 100 }`
- **Expected Outcome**: `PERMISSION_DENIED` (Merchant edit restricted to owned shops)

### 6. Menu Price Poisoning with Negative Value (Bounds Attack)
- **Target Path**: `/restaurants/my_restaurant/menu_items/dish_1`
- **Requestor Auth**: `my_restaurant_merchant`
- **Payload**: `{ "menu_id": 1, "restaurant_id": 10, "item_name": "Poison Dish", "price": -500 }`
- **Expected Outcome**: `PERMISSION_DENIED` (Price must be >= 0)

### 7. Non-ASCII Character Spraying on IDs (Path Poisoning)
- **Target Path**: `/users/user_with_garbage_$%^&*()`
- **Requestor Auth**: `attacker`
- **Payload**: `{ "username": "Hack" }`
- **Expected Outcome**: `PERMISSION_DENIED` (Invalid ID format)

### 8. Denial of Wallet through Massive Field Sizes (DeDoS Attack)
- **Target Path**: `/users/attacker_user`
- **Requestor Auth**: `attacker_user`
- **Payload**: `{ "username": "[A highly compressed 5MB-sized string...]" }`
- **Expected Outcome**: `PERMISSION_DENIED` (String length exceeded constraints)

### 9. Illegal Group Room Member Expansion (Array Overrun Attack)
- **Target Path**: `/group_rooms/room_456`
- **Requestor Auth**: `attacker` (Regular guest trying to override owner or append infinite users)
- **Payload**: `{ "owner_id": "legit_owner", "members": [ ...1000 members... ] }`
- **Expected Outcome**: `PERMISSION_DENIED` (List array boundaries violated)

### 10. Force Closing Sibling Restaurants via Reports (Relational Spoof)
- **Target Path**: `/reports/report_999`
- **Requestor Auth**: `dish_washer_merchant_722`
- **Payload**: `{ "report_id": "report_999", "restaurant_id": 4, "report_type": "closed", "status": "resolved" }`
- **Expected Outcome**: `PERMISSION_DENIED` (Regular user or merchant cannot directly resolve reports or force close/update state metadata)

### 11. Spoofing Verification Email Domain (Spoofing Alert)
- **Target Path**: `/reports/report_123`
- **Requestor Auth**: Anonymous or Attacker with `email_verified: false`
- **Payload**: `{ "report_id": "report_123", "status": "resolved" }`
- **Expected Outcome**: `PERMISSION_DENIED`

### 12. Skipping Consensus Phase (State Shortcutting)
- **Target Path**: `/group_rooms/lobby_alpha`
- **Requestor Auth**: `participant_45`
- **Payload**: `{ "owner_id": "not_me", "room_id": "lobby_alpha", "final_decision": "Attacker's restaurant choice overrides everything" }`
- **Expected Outcome**: `PERMISSION_DENIED`

---

## 3. Test Runner Specification (`firestore.rules.test.ts`)

```typescript
import { 
  assertFails, 
  assertSucceeds, 
  initializeTestEnvironment, 
  RulesTestEnvironment 
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'responsible-arch-t8gvj',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8')
    }
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe('Central Decision Assistant Security Rules Unit Tests', () => {
  test('User Profile Identity Spoofing Fails', async () => {
    const attackerContext = testEnv.authenticatedContext('some_attacker_456', { email: 'attacker@gmail.com' });
    const faultyProfileRef = attackerContext.firestore().doc('users/legit_user_123');
    await assertFails(faultyProfileRef.set({ username: 'Spoof' }));
  });

  test('Regular User Escalating Profile to admin Fails', async () => {
    const userContext = testEnv.authenticatedContext('regular_user_789', { email: 'anybody@gmail.com', email_verified: true });
    const myProfileRef = userContext.firestore().doc('users/regular_user_789');
    await assertFails(myProfileRef.set({ user_id: 'regular_user_789', email: 'anybody@gmail.com', username: 'Hacker', role: 'admin' }));
  });
});
```
