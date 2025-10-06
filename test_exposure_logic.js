// Test script to verify correct exposure logic

// Test Case 1: User viewed ALL creators in combination
const user1 = { creator_ids: new Set(['A', 'B', 'C', 'D']) }
const combination = ['A', 'B', 'C']

// Current logic (.some)
const currentLogic = Array.from(user1.creator_ids).some(id => new Set(combination).has(id))
console.log('Test 1 - User viewed ALL (A,B,C,D), testing combination (A,B,C):')
console.log('  Current (.some):', currentLogic, '✓ (correct - user HAS exposure)')

// Proposed logic (.every)
const proposedLogic = combination.every(id => user1.creator_ids.has(id))
console.log('  Proposed (.every):', proposedLogic, '✓ (correct - user HAS exposure)')

console.log('  Both give same result: ✓\n')

// Test Case 2: User viewed SOME creators in combination
const user2 = { creator_ids: new Set(['A', 'B', 'Z']) }

const currentLogic2 = Array.from(user2.creator_ids).some(id => new Set(combination).has(id))
console.log('Test 2 - User viewed SOME (A,B,Z), testing combination (A,B,C):')
console.log('  Current (.some):', currentLogic2, '✗ WRONG (says user has exposure but missing C)')

const proposedLogic2 = combination.every(id => user2.creator_ids.has(id))
console.log('  Proposed (.every):', proposedLogic2, '✓ CORRECT (user does NOT have full exposure)')

console.log('  Results differ - proposed is CORRECT\n')

// Test Case 3: User viewed NO creators in combination
const user3 = { creator_ids: new Set(['X', 'Y', 'Z']) }

const currentLogic3 = Array.from(user3.creator_ids).some(id => new Set(combination).has(id))
console.log('Test 3 - User viewed NONE (X,Y,Z), testing combination (A,B,C):')
console.log('  Current (.some):', currentLogic3, '✓ (correct - no exposure)')

const proposedLogic3 = combination.every(id => user3.creator_ids.has(id))
console.log('  Proposed (.every):', proposedLogic3, '✓ (correct - no exposure)')

console.log('  Both give same result: ✓\n')

console.log('============================================')
console.log('CONCLUSION:')
console.log('Current .some() logic is WRONG for Test Case 2')
console.log('It counts partial exposure as full exposure')
console.log('This inflates the "users_with_exposure" metric')
console.log('============================================')
