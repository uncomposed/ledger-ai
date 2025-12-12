
How might we make an web and mobile app that uses relational lists to organize daily information with enough fidelity that tasks can be outsourced with a click?
How might we allow people to interact with this system in as minimally invasive way as possible?
# Data Block Diagram 
## Entity
The **Entity** is the top-level owner of data and lenses. Everything in the system is scoped to an Entity.
- Locations, Tracks, Goals, Tasks, etc. all belong to an Entity.
- Locations and child Entities can be treated as **scoped views** or sub-contexts, but they do not own their own lens definitions or “global” data.
- Entity admins can **bind/unbind lenses** to their Entity (or to specific scopes like locations), but they cannot define new lens types inside the Entity itself.
Examples:
- An individual user is an Entity and may be the only admin, contributor, and actor.
- A small business is an Entity; each branch can be a child Entity.
- A shared vacation home can be an Entity with multiple admins, many contributors, and a volatile inventory/task list.
A single human might be part of multiple Entities, e.g.:
- Their personal Entity.
- The parent business Entity.
- A child Entity for a specific branch/location.
Admins at lower scopes are delegated permissions by admins of the parent Entity, if one exists.
---
## **Goal**
A **Goal** is a directional statement that should read naturally if prefixed with:
> “It would be great if…” 

Goals:
- Do **not** prescribe how to get there.
- Can have many possible **Solutions**.
- Anchor Planning (meta-solutions), Questions, and execution.
Example:
- “It would be great to have a warm, hearty meal for dinner.”
- “It would be great if the house was guest-ready by Friday.”
---
## **Question**
A **Question** is a structured query to the Entity’s context or to a user that narrows down the solution space.
- Every Question is answered via a **Task** assigned to an Actor.
- Questions are **typed**, not free-form: number, enum, boolean, or multi-select.
- This reduces cognitive load and makes answers easy to map to next steps (filter Solutions, choose vendors, tweak plans, etc.).
Questions may be raised:
- Right after a Track is captured, to confirm the correct Lens or Goal.
- After an AI Actor finishes analysis and proposed data is ready for review.
- By a third-party contractor bidding on a Solution (e.g., “What’s your budget?”, “What time can I access the house?”).
- By an Actor working a Task who needs clarification or wants to update constraints.
---
## **Answer**
An **Answer** is the recorded result of a Question.
- Each Answer is produced by exactly one Task.
- Answers can constrain which Solutions remain viable for a Goal.
- Answers can trigger further Planning, ChangeSets, or follow-up Questions.
---
## **Solution**
A **Solution** is one possible method of fulfilling a Goal. It defines _what will be done_ in a reusable, template-like way.
A Solution contains:
- **Steps** (1:m) – actor-agnostic units of work.
- **ScheduleConstraints** (1:m) – ordering and temporal relationships between Steps.
- Resource and Skill requirements per Step.
Solutions are refined and instantiated through Planning and ChangeSets. If a Solution doesn’t fit the available actors, resources, or skills, Tasks can be created to tweak or rebuild it.
---
## **Step**
A **Step** is a unit of work within a Solution.
- Defines _what must be done_, but not _who does it_.
- Declares required **Resources** (equipment and consumables).
- Declares required **Skills**.
- Connects to other Steps via **ScheduleConstraints** (dependencies like “do A before B”).
- When a Solution is executed, each Step has a **1:1 Task** created for actual execution.
This preserves your invariant: every Step becomes a Task, but not every Task comes from a Step.
---
## **Task**
A **Task** is the core unit of execution and the main interface between people/actors and the Entity database.
Tasks can originate from many sources:
- From **Steps** – executing a Solution.
- From **Planning** – applying meta-solutions (e.g., “plan my week of dinners”).
- From **ChangeSets** – applying or rejecting proposed changes.
- From **Questions** – answering decisions.
- From **Verification** – checking that work or skills meet expectations.
Properties:
- Tasks are always tied to an Entity.
- Tasks are assigned to one or more **Actors** (R/A/C/I roles).
- Tasks can be **outsourced** by changing the responsible Actor to a vendor or third-party Actor.
- Tasks can be completed via:
    - explicit confirmation by the responsible/accountable Actor,
    - a verification workflow (e.g., another Actor reviews a photo Track as evidence).
- Tasks are the **only way** to:
    - produce Answers,
    - apply ChangeSets,
    - create Verifications.
There are no “hidden” system changes; all meaningful work is expressed as Tasks for auditability.
---
## **Actor**
An **Actor** is something or someone that can autonomously complete Tasks.
- A human user.
- An AI worker with an API key.
- A third-party vendor or contractor.
A coffee cup, for example, is **not** an Actor; it is a Resource (equipment) used by Actors.
Actors:
- Have **Skills** that can be used to choose suitable Solutions and assign Tasks.
- Are linked to Tasks with roles (Responsible, Accountable, Consulted, Informed, Vendor, etc.).
#### **Actor types (conceptual roles)**
1. **Contributor**
    - Captures items through the app (via Sensors/Lenses).
    - Can assign/unassign themselves to Tasks.
    - Can complete Tasks they are responsible for.
2. **Entity admin**
    - Responsible for the Entity.
    - Can assign/unassign contributors to Tasks.
    - Can add/remove contributors from the Entity.
    - Can bind/unbind Lenses to/from the Entity.
    - Can add/remove lists or configurations for the Entity.
(“Actor type” here is a role pattern, not necessarily a strict enum in the schema.)
---
## **Resources & InventoryItem**
**Resources** are types of things that Tasks and Steps depend on:
- Equipment (e.g., “Cordless drill”, “Saucepan”).
- Consumables (e.g., “Penne 1lb box”, “Tomato sauce can”).
- Service blocks (e.g., “2-hour professional cleaning slot”).
Resources themselves are generic. Concrete stock is tracked via **InventoryItems**:
- InventoryItem ties a Resource to:
    - an Entity,
    - a Location,
    - quantity,
    - expiration,
    - vendor type, unit of measure, estimated cost, etc.
A lack of required Resources can:
- trigger Tasks to procure them (e.g., “to buy” Tasks),
- generate Questions about outsourcing (e.g., hire a service instead of doing it in-house).
---
## **Skill**
A **Skill** is a capability relevant to completing Tasks.
- Actors claim Skills (with optional Verification).
- Steps require Skills.
- Planning considers available Skills when selecting Solutions and assigning Tasks.
- Skills for third-party vendors can be claimed and later validated via Verification Tasks.
Unverified skills can be marked as such, and verified skills can receive badges or levels based on evidence.
---
## **Location**
A **Location** is a place in space; Locations form a tree (or graph) from coarse to fine granularity:
- House → Basement → Pantry → Third shelf.
- Office → 3rd Floor → Conference Room B.
Locations are used to:
- place InventoryItems,
- scope Tasks (where the work happens),
- interpret Tracks captured by Sensors (where/when something was seen).
The nesting can reach up to legal/ownership boundaries (e.g., a building with a deed) and down to sensor resolution (e.g., GPS or room-level beacons).
---
## **Sensor**
A **Sensor** is any method of generating a Track for an Entity. Think “how did this input get into the system?”
**Types:**
1. **First class**
    - Hardware running the app uses an integral sensor (e.g., phone camera) to capture Track(s) in-app.
    - Rich telemetry: position, orientation, timestamp, maybe device context.
2. **Second class**
    - Capture happens outside the app (scanner, OS screenshot, external service).
    - The Track is submitted via API or upload with adequate telemetry (time, source, maybe location).
3. **Third class**
    - Capture is outside the app and telemetry is incomplete or missing.
    - The Track still must provide an entity_id, but other context may need to be inferred via Questions.
All captures must provide an entity_id so the system knows where to route analysis and Tasks.
---
## **Track**
A **Track** is the raw captured input from a Sensor:
- Photos of dishes, receipts, whiteboards, pantries.
- Screenshots.
- Pasted text blocks.
- Scanned lists.
- Emails or forwarded messages.
Each Track is associated with:
- an Entity (owner),
- a Sensor (how it was captured),
- optional Location and other telemetry,
- later: one or more Goals via Lenses and Planning.
Tracks are not written directly into core lists; they always flow through Lenses and Analyst Tasks, which produce structured ChangeSets.
---
## **Lens**
A **Lens** is a reusable template for interpreting a class of Tracks into structured data aligned with a Goal.
A Lens specifies:
- Which Goal(s) a Track might relate to (e.g., “meal planning”, “inventory update”, “expense tracking”).
- Which context to query from the Entity (Resources, Skills, existing Solutions, etc.).
- Instructions for an Analyst (human or AI) on how to interpret the Track.
- The output schema and which ChangeSet(s) to produce (new Tasks, InventoryItems, Solutions/Steps, etc.).
**Types:**
1. **Native**
    - Defined and maintained by the core product team.
    - Examples: inventory lens, to-do lens, recipe lens, receipt lens.
2. **Community**
    - Contributed by third-party developers.
    - Accepted and curated into the codebase.
Lenses are **bound** to Entities by admins (which Lenses are active where), but Entities do not own or define Lens types themselves.
---
## **Analyst**
An **Analyst** is an Actor that processes Tracks through Lenses and writes _proposals_ (ChangeSets), not direct changes.
All Analyst implementations:
- Share a common interface.
- Log runs to a lens_run log with a processor_type (AI, manual, professional, etc.).
- Produce ChangeSets that are later reviewed/applied via Tasks and Questions.
**Types:**
1. **AI**
    - Automated analysis via an AI Actor (user’s own API key or hosted tier).
    - Can be rate-limited or queued in the paid version.
2. **Manual**
    - Human user manually interprets Tracks and enters structured data.
3. **Professional review**
    - Domain experts (tradespeople, nutritionists, cleaners, etc.) who review or tweak AI output, bid on work, or issue referrals.
4. **Enterprise (WIP)**
    - Custom, policy-driven analysis and approval flows for larger orgs.
---
## **Approval queue**
The **approval queue** is a view over pending Questions that gate high-impact or irreversible changes.
Items appear in the approval queue when:
- A ChangeSet requires confirmation (e.g., inventory diffs, structural plan changes).
- A vendor bid needs acceptance or rejection.
- Policies require human review (e.g., high cost, shared space impact).
Actors who can answer:
- Any Actor who is Responsible or Accountable for the underlying Task.
- Entity admins (depending on policy).
Common queue items:
1. New entries (e.g., proposed new recurring Tasks, new inventory items).
2. Changed entries with diffs (e.g., “we think your pantry changed like this”).
3. Vendor bids (e.g., cleaning company offers to complete Tasks for $X).
4. Other policy-driven approvals.
---
## matrix
| from\has           | Entity | Goal | Question | Answer | Solution | Step | Task | Actor | InventoryItem | Skill | Location | Sensor | Track | Verification | Planning | ChangeSet | Resource | ScheduleConstraint |
| ------------------ | ------ | ---- | -------- | ------ | -------- | ---- | ---- | ----- | ------------- | ----- | -------- | ------ | ----- | ------------ | -------- | --------- | -------- | ------------------ |
| Entity             | 1:m    | 1:m  |          |        | 1:m      |      | 1:m  | 1:m   | 1:m           |       | 1:m      | 1:m    | 1:m   |              |          | 1:m       |          |                    |
| Goal               |        | 1:m  | 1:m      |        | 1:m      |      |      |       |               |       |          |        |       | m:n          | 1:m      |           |          |                    |
| Question           |        |      |          | 1:m    |          |      |      |       |               |       |          |        |       |              |          |           |          |                    |
| Answer             |        |      |          |        | 1:m      |      | m:1  |       |               |       |          |        |       | m:n          |          |           |          |                    |
| Solution           |        | 1:m  |          |        | m:n      | 1:m  |      |       |               |       |          |        |       | m:n          | 1:m      |           |          |                    |
| Step               |        |      |          |        |          |      | 1:1  |       |               | 1:m   |          |        |       | m:n          |          |           | 1:m      | 1:m                |
| Task               |        |      | 1:m      |        |          |      |      | m:n   |               |       | 1:1      |        |       | m:n          | 0..m     | 1:m       |          |                    |
| Actor              | 1:m    |      |          |        |          |      |      |       |               | 1:m   |          | 1:m    | 1:m   |              |          |           |          |                    |
| InventoryItem      |        |      |          |        |          |      |      |       |               |       | 1:1      |        |       |              |          |           |          |                    |
| Skill              |        |      |          |        |          |      |      |       |               |       |          |        |       | m:n          |          |           |          |                    |
| Location           |        |      |          |        |          |      |      |       |               |       | 1:m      |        |       |              |          |           |          |                    |
| Sensor             |        |      |          |        |          |      |      |       |               |       |          |        | 1:m   |              |          |           |          |                    |
| Track              |        | m:n  |          |        |          |      |      |       |               |       |          |        |       |              |          |           |          |                    |
| Verification       |        |      |          |        |          |      | 1:1  |       |               |       |          |        |       |              |          |           |          |                    |
| Planning           |        |      |          |        |          |      | 1:1  |       |               |       |          |        |       |              |          |           |          |                    |
| ChangeSet          |        |      | 1:m      |        |          |      |      |       |               |       |          |        |       |              |          |           |          |                    |
| Resource           |        |      |          |        |          |      |      |       | 1:m           |       |          |        |       |              |          |           |          |                    |
| ScheduleConstraint |        |      |          |        |          |      |      |       |               |       |          |        |       |              |          |           |          |                    |

# Use Cases
## 1. Scenario: “Plan a week of dinners from pantry photo and outsource groceries”

### **1.1 Setup (what already exists)**
Before anything happens:
- **Entity** E:
    - has Location records (kitchen, pantry, fridge).
    - has some existing InventoryItems (things scanned earlier).
    - has Actors:
        - Human user (A_user)
        - An AI worker (A_ai) belonging to the entity.
- **Goal** (optional):
    - You might already have a generic goal:
        - “It would be great to have meals this week” (Goal G_meals).
    - Entity 1:m Goal is used here.
- **Solution templates**:
    - Recipe solutions (“Chili”, “Pasta bake”, etc.) each with Steps and Skills and Resource references.
    - Entity 1:m Solution, Solution 1:m Step, Step 1:m Skill, Step 1:m Resource.
All of that fits nicely into the Entity, Goal, Solution, Step, Skill, Resource rows in your matrix.
---
### **1.2 Capture pantry photo**
The user opens the mobile app in the kitchen and snaps a pantry photo.
**Entities touched:**
- **Sensor** S_phone_cam
    - Belongs to E (via Entity 1:m Sensor).
    - Sensor 1:m Track.
- **Track** T_pantry
    - New row: Track with:
        - entity_id = E
        - sensor_id = S_phone_cam
        - maybe location_id = pantry
    - Entity 1:m Track, Sensor 1:m Track cover this.
We **don’t** yet have to attach a Goal; maybe:
- Either we immediately link Track to G_meals (via your Track m:n Goal),
- Or we leave it unattached until the AI/Planning task figures it out.
---
### **1.3 Task: “Figure out what to do with this Track” (meta-solution entry point)**
The app creates a new **Task** T_understand_pantry for the AI actor:
- Type: analysis / meta_solution.
- Actor: A_ai (via Task m:n Actor with role = Responsible).
- Location: pantry (via Task 1:1 Location).
- It will:
    - parse the image into proposed Resource/InventoryItem changes,
    - and potentially attach the track to an existing goal or create a new goal.
At this point:
- Task row is used:
    - Entity 1:m Task
    - Task m:n Actor
    - Task 1:1 Location
---
### **1.4 The analysis/meta-solution Task produces a ChangeSet**
From T_understand_pantry, the AI:
1. Detects items in the photo (flour, beans, tomatoes, etc.).
2. Computes a proposed inventory diff: new InventoryItems or updated quantities.
Instead of writing them directly:
- It creates a **ChangeSet** CS_inventory_diff:
    - attached to E (via Entity 1:m ChangeSet).
    - attached to T_understand_pantry (via Task 1:m ChangeSet).
This ChangeSet contains:
- proposed InventoryItem insert/update rows linked to:
    - Resource (via Resource 1:m InventoryItem)
    - Location (via InventoryItem 1:1 Location).
No contradictions with your matrix: ChangeSet sits under Entity and Task, and Resource/InventoryItem/Location relations are already defined.
---
### **1.5 Approval Questions for the inventory diff**
The system now needs the user to confirm the diff:
- It creates a **Question** Q_confirm_inventory:
    - attached to a Goal if you like (but could just be ChangeSet-context).
    - Goal 1:m Question if we link to G_meals.
- The ChangeSet row shows:
    - ChangeSet 1:m Question (your matrix’s ChangeSet row has Question 1:m).
The user needs to answer:
> “Is this an accurate representation of your current pantry inventory? [Accept all / Adjust / Reject]”

To answer that, we create a **Task** T_answer_inventory_question assigned to the human A_user:
- Task m:n Actor (R = user, maybe C = AI).
- Task 1:m Question (Task row has Question 1:m).
When the user responds:
- An **Answer** Ans_inventory is created:
    - Question 1:m Answer (matrix).
    - Answer m:1 Task (i.e., Ans_inventory points to T_answer_inventory_question).
We’ve satisfied your invariant:
- “the only way to get an answer is a task” → Answer is always linked to a Task (via Answer m:1 Task).
If accepted, a later Task (e.g., T_apply_inventory_changes) will apply the ChangeSet to live InventoryItems.
---
### **1.6 Planning the weekly meals (Planning on the Goal)**
Now that the inventory is up to date, the user (or AI) initiates:
> “Plan dinners for the next 7 days.”

This is where **Planning** and meta-solutions show up.
1. We already have Goal G_meals (“It would be great to have dinners this week”).
2. We create a **Planning** record P_goal_meals with:
    - subject_type = 'goal'
    - subject_id = G_meals
    - Maybe a metastandard solution: “weekly-meal-planning-meta-solution”.
3. We create a **Task** T_run_goal_planning:
    - type: meta_solution.
    - assigned to A_ai.
    - linked to P_goal_meals (via the conceptual Planning 1:1 Task).
This task:
- inspects:
    - InventoryItems,
    - existing Solution recipes,
    - any Answers to preference Questions,
- then proposes:
    - a set of Solutions for each dinner slot,
    - and a ChangeSet for “to buy” items.
Entities/relations used:
- Goal 1:m Planning
- Planning 1:1 Task
- Task 1:m ChangeSet for “to buy” list proposals.
---
### **1.7 Planning the Solutions (Planning on the Solution level)**
For each recipe Solution it chooses (say Sol_chili):
1. It may create a **Planning** P_solution_chili:
    - subject_type = 'solution'
    - subject_id = Sol_chili
2. And a **Task** T_run_solution_planning:
    - type: meta_solution.
    - assigned to A_ai.
    - linked 1:1 to P_solution_chili.
This Solution-level planning can:
- refine Steps:
    - ensure each step has clear Skill & Resource requirements (Step 1:m Skill, Step 1:m Resource).
- schedule them into a timeline (internal to Step or another related structure).
- identify missing resources, then add them to the **same or a new ChangeSet** for grocery tasks.
Still fully consistent:
- Solution 1:m Step
- Step 1:1 Task will be used later for execution tasks.
- Goal 1:m Solution links G_meals to Sol_chili, etc.
---
### **1.8 Generating execution Tasks (cook and buy)**
From the planning tasks, we now spawn **execution tasks**:
1. **Cook tasks** (Step-backed Tasks)
    - For each Step in the chosen recipes:
        - Create a Task with step_id (conceptually 1:1 with Step).
        - Assign Actors (which family member or external cook).
        - Step 1:1 Task, Task m:n Actor, Task 1:1 Location.
2. **Buy tasks** (procurement tasks)
    - For missing Resources:
        - Add proposed “to buy” Tasks to the ChangeSet CS_meal_plan_groceries.
    - These tasks:
        - may not be Step-backed (they’re about procurement, not the recipe Step itself).
        - still use Task’s normal machinery.
The ChangeSet now captures:
- new “to buy” Tasks (Resource 1:m InventoryItem and tasks referencing eventual inventory updates),
- any additional structural changes (new Solutions, if user wants to save new meals).
---
### **1.9 Questions for outsourcing and final approval**
Before applying these new Tasks to the live Task list, the Planning or ChangeSet logic creates:
1. **Question** Q_outsource_groceries under ChangeSet or Goal:
    - e.g., “Do you want to outsource grocery shopping for these items?”
2. Task T_answer_outsource assigned to the user:
    - Task 1:m Question, Task m:n Actor.
Answering:
- Creates an Answer Ans_outsource:
    - Answer m:1 Task.
If user replies “Yes, outsource”:
- The system may:
    - adjust the TaskActors to assign a **vendor Actor** to the “to buy” Tasks (via Task m:n Actor with role=vendor),
    - or create new vendor Tasks while keeping the user as R or A.
Finally, there may be a separate **approval Question** Q_apply_meal_plan_changes:
- “Approve weekly meal plan and associated tasks?”
- Leading to an Answer and then a Task T_apply_meal_plan_changes that:
    - applies the ChangeSets:
        - makes the new cooking Tasks “live”,
        - schedules them at specific dates/times,
        - creates/updates InventoryItems once purchases complete.
---
### **1.10 Verification (optional)**
After the week:
- Some Tasks (cook chili, buy groceries) might have associated **Verification**:
    - e.g., Verification rows:
        - subject_type = task or solution
        - subject_id = the cooking Task or Solution recipe
        - created via a Task that reviews photos / outcomes.
- A new Task T_verify_meal_success for an admin or AI produces:
    - Verification with Verification 1:1 Task.
This lets you build confidence in both:
- the human’s Skill (cooking competency), and
- the Solution (is this recipe actually working well for this entity?).
## 2. Scenario: Trip Outfit Planning With Optionality Optimization
### **Lists**
- **Goals**
    - Trip Goal
    - Daily Outfit Goals (decomposed automatically via Planning)
- **Solutions**
    - Outfit Solutions (leaf solutions: shirts, pants, shoes combinations)
    - Composite Solutions (per-day outfit plans)
- **InventoryItems**
    - Clothing items (shirts, pants, shoes, accessories)
- **Tasks**
    - Planning tasks (goal decomposition, solution selection, optimization)
    - Procurement tasks (only if required)
- **Questions**
    - Clarifying questions about constraints (weather range, dress code, allowed repeats, etc.)
- **Resources**
    - Clothing items linked to Locations (closet, laundry basket, suitcase)
- **ScheduleConstraints**
    - Packing deadline
    - Laundry availability windows
    - Weather forecast ranges
---
### **1. Capture the Trip Goal**
User submits a track such as:
- A screenshot of flight itinerary
- A typed note: “Going to NYC for 4 days, mix of casual and office days”
- A voice note: “Need outfits for a 4-day trip.”
**Lens:** Trip Planning
**Generated Goal:**
> _It would be great if I had appropriate outfits for a 4-day trip.

A **Planning Task** is created.

---
### **2. Planning Task decomposes the Goal**
The Planning actor (AI or human) decomposes the large goal into **Daily Outfit Goals**, using:
- Weather forecast for each day
- Trip context inferred from the track
- User’s preferences (business casual for client meeting Day 2)
Generated subgoals:
- **Day 1 Outfit Goal**
- **Day 2 Outfit Goal (Client Meeting)**
- **Day 3 Outfit Goal**
- **Day 4 Outfit Goal (Cold Morning)**
A **ChangeSet** is proposed containing:
- Subgoals
- Initial candidate Solutions for each
- Any clarifying Questions
---
### **3. Optionality Optimization activates**
For each **Daily Outfit Goal**, there may be **5–15 candidate Solutions** generated from inventory:
Example (Day 2 Client Meeting):
- Solution A: navy chinos + blue button-down + loafers
- Solution B: charcoal trousers + white shirt + dress shoes
- Solution C: black jeans + sweater + boots (less formal)
The Optionality engine now considers the **whole trip**, not just each day independently.
#### **Objectives:**
- Cover _all_ Daily Outfit Goals
- Minimize new Items to procure
- Minimize total packed volume/weight
- Maximize variation (if user prefers)
- Honor constraints (weather, dress code, color clashes)
- Avoid conflicts in shared Resources (e.g., only one pair of loafers)
#### **The optimization is allowed to:**
- Choose one Solution per Daily Goal
- Prefer Solutions that reuse the same shoes/jacket, if that reduces packing
- Reject any Solution requiring missing Resources unless procurement is allowed
#### **Example output:**
- Day 1 → Solution C
- Day 2 → Solution A
- Day 3 → Solution D
- Day 4 → Solution C (reusing fleece jacket)
Total required resources:
- 1 pair of loafers
- 1 fleece jacket
- 3 shirts
- 2 pairs of pants
Procurement recommendations:
- None needed.
A **Planning Task** finalizes the selected composite Solution.
---
### **4. Composite Solution is created**
A **Day-by-Day Outfit Composite Solution** is generated, containing:
- Day 1 Outfit Solution
- Day 2 Outfit Solution
- Day 3 Outfit Solution
- Day 4 Outfit Solution
This composite Solution links to:
- Required InventoryItems
- Required Skills (none for dressing)
- Packing Steps
- ScheduleConstraints (packing deadline)
This composite Solution is attached to the Trip Goal.
---
### **5. Packing Steps and Tasks are generated**
For each unique Resource required, steps are created:
#### **Example Steps:**
- “Locate loafers in bedroom closet”
- “Pack fleece jacket”
- “Fold shirts using folding board”
- “Place outfits in suitcase”
Each Step generates exactly **one Task**.
Tasks are grouped under a **Packing Plan** (Planning parent).
Tasks are scheduled based on:
- Availability of items (some in laundry)
- Packing deadline
- Dependency constraints (“wash shirt before folding”)
---
### **6. Approval and execution**
Tasks requiring clarification (e.g., “loafers not found—substitute sneakers?”) generate new **Questions**.
The user or entity admin reviews:
- The ChangeSet for the Outfit Plan
- Procurement recommendations (if any)
- Packing plan
Once approved:
- Tasks are actionable
- Packing begins
- Completion evidence (photo of packed suitcase) is stored as Track + Verification
---
### **7. Outcome**
The user ends with:
- A coherent 4-day outfit plan
- Zero new purchases
- Minimal packing load
- A reproducible composite Solution for future trips
- Captured Verification and ChangeSet history for audit
---
### **Why this is a great demonstration of Optionality Optimization**
This use case shows the full power of your system:
- **Composable Goals** (Trip → Days → Contexts)
- **Composable Solutions** (Daily outfits → full trip plan)
- **Minimal user input** (a single track: itinerary)
- **LLM-first workflow** (Planning Tasks, clarifying Questions)
- **Resource-driven reasoning** (inventory, location, laundry state)
- **Optimization** (reuse, reduce packing, minimize missing items)
- **Task generation** (packing steps)
- **Approval + ChangeSets** (auditable change to entity state)
## 3. Scenario: Home Maintenance & Seasonal Planning
### **Lists**
- **Goals**
    - Seasonal Maintenance Goal
    - Derived Sub-Goals (HVAC prep, gutter cleaning, filter changes, etc.)
- **Solutions**
    - Maintenance Solutions (leaf-level)
    - Composite Solutions (full seasonal plan)
- **InventoryItems**
    - Filters, cleaning supplies, ladders, HVAC components
- **Tasks**
    - Diagnostic tasks
    - Maintenance tasks
    - Procurement tasks
    - Outsourcing tasks
- **Questions**
    - Clarifying constraints (budget, timing, DIY vs outsource, allergies, ladder comfort)
- **Resources**
    - Tools (ladder, hose, gloves)
    - Consumables (AC filters, salt bags, caulk)
- **ScheduleConstraints**
    - Weather windows
    - Safety timing (don’t clean gutters in rain)
    - Task dependencies (don’t winterize before final lawn mowing)
---
### **1. Capture the Seasonal Goal**
The user initiates the process by capturing:
- A picture of leaves clogging the gutter
- A screenshot of a “Fall Home Maintenance Checklist”
- A voice note: “Prep the house for winter.”
**Lens:** Home Maintenance
**Generated Goal:**
> _It would be great if my home was fully prepared for the upcoming season._

A **Planning Task** is created.

---
### **2. Planning Actor decomposes the Seasonal Goal**
The Planning actor (AI or human) reviews the track + entity context:
Inputs:
- House type (single-family, two-story)
- Existing resources (ladder owned, gutter scoop missing)
- Location (weather forecasts)
- Maintenance history (last HVAC filter change logged 3 months ago)
Outputs — **Derived Sub-Goals**:
- **Gutter Cleaning Goal**
- **HVAC Filter Replacement Goal**
- **Winterization Goal (pipes + windows)**
- **Exterior Inspection Goal (roof, siding)**
- **Safety Check Goal (smoke/CO detectors)**
A **ChangeSet** is created with proposed subgoals and required clarifying Questions.
---
### **3. Minimum Question Set (MQS)**
System generates Questions to narrow the solution space, e.g.:
- “Are you comfortable climbing a ladder?”
- “Do you prefer to outsource anything involving heights?”
- “Do you already have replacement HVAC filters?”
- “What is your budget for contracting services this season?”
- “Is the outdoor faucet frost-free?”
Answers determine:
- Which Solutions remain viable
- Whether Tasks become procurement tasks or outsourcing tasks
- Safety and Scheduling constraints
---
### **4. Generate Solutions for Each Sub-Goal**
The system produces **multiple candidate Solutions** per Sub-Goal.
#### Ex: **Gutter Cleaning Goal**
- **Solution A:** DIY gutter cleaning using ladder + gloves + scoop
- **Solution B:** DIY from ground using hose extension
- **Solution C:** Outsourced to local contractor
- **Solution D:** Skip (blocked → if ladder uncomfortable + hose won’t reach)
#### Ex: **HVAC Filter Replacement Goal**
- **Solution X:** Replace filter with size 20×25×1 (in stock)
- **Solution Y:** Replace filter with premium allergen filter (not in stock)
- **Solution Z:** Outsource HVAC inspection and filter replacement
#### Points of evaluation:
- Resource availability
- Actor skills (ladder comfort = skill)
- Weather (rain blocks some solutions)
- Cost constraints
---
### **5. Composite Solution Optimization (Optionality Optimization)**
This is where the system shows its power.
The Planning actor looks across _all_ Sub-Goals and tries to choose a set of Solutions that:
- Minimize total cost
- Minimize total time
- Respect weather windows
- Minimize procurement requirements
- Prefer reusing tools already out (ladder needed once → align tasks)
- Avoid actor skill conflicts
- Cluster tasks geographically (all outdoor tasks grouped)
- Maximize safety (avoid ladder tasks in wind)
#### **Example composite output:**
- Use **Solution B** (ground gutter cleaning) due to user’s ladder discomfort
- Use **Solution X** (filter in stock)
- Use **Solution Y** (premium filter) only if allergies flagged
- Winterize exterior: drain hose + install foam cover
- Safety check: replace 1 expired CO alarm → triggers procurement task
- Align tasks for Saturday morning (weather clear)
A complete **Seasonal Maintenance Plan (Composite Solution)** is created.
---
### **6. Steps → Tasks generation**
Each chosen Solution breaks into Steps.
Example Steps (Gutter Cleaning Solution B):
1. Retrieve hose extension from garage
2. Check water pressure
3. Flush gutters from ground
4. Inspect for downspout blockage
Each Step becomes **a Task** and is mapped to:
- Required Resource
- Required Skill (if any)
- Required Location
- Schedule constraints
- Actor(s) who can execute
Associated procurement Tasks generated:
- Buy foam faucet cover
- Buy CO alarm replacement
- Buy window insulation film (if stock low)
Procurement Tasks appear in:
- “To Buy” list
- Approval Queue (if entity policy requires approval)
---
### **7. Outsourcing workflow**
If user answered:
> “Outsource ladder tasks”

Then any ladder-based Step auto-generates:
- A new Task: _“Select contractor for gutter and roof inspection.”_
- A new Question: _“Do you want bids from local vendors?”_
Vendor bids show in Approval Queue:
- Contractor A: $180, available next week
- Contractor B: $150, available this weekend
- Contractor C: $220, includes roof photo report
Selecting one triggers contracting workflow.
---
### **8. Execution & Verification**
As Tasks are completed:
- Photos become Tracks that serve as Verification
    - cleaned gutter photo
    - installed filter photo
    - foam faucet cover photo
- Verification can be done by responsible Actor, accountable Actor, or automated model
- Completion updates the Seasonal Maintenance Goal → eventually satisfied
ChangeSets log every update to the entity.
---
### **9. Outcome**
The user ends with:
- A safe, complete, optimized Seasonal Maintenance Plan
- Fully scheduled Tasks
- Optional outsourcing handled seamlessly
- All procurement items approved and tracked
- Verification artifacts stored
- A reusable Solution schema for next winter
- A loop that gets easier each season
---
### **Why this is a premier use case**
This use case exercises **every major structure in your ER model**:
- Composable Goals
- Composable Solutions
- Goal decomposition via Planning
- Task generation and Step mapping
- Optionality Optimization across multiple domains
- Procurement and outsourcing
- Actor skills and safety constraints
- Environmental context (weather)
- ChangeSets, Approvals, Verification
- Resource-based reasoning

# Risks
1. SQL injection 
	1. Description: This app is a database with open entry in the form of tracks. The AI and changeset might help but both can be overcome with prompt injection and social engineering respectively 
	2. Mitigation: search and contain potential SQL from tracks
	3. Mitigation: disarm SQL payloads masquerading as payload in a ChangeSet
2. Prompt injection 
	1. Actors may have extensive permissions and skills including dumping information from the Entity somewhere on the internet. This could be done via a track that prompt engineers an AI actor to dump the database somewhere. 
	2. Mitigation: in the risk measurement task hopefully an actor decides this is a major risk and prompts the administrator or accountable actor to approve the task execution
# Potential integrations
- Calendars
- Jira
- Email forwarding (need to be able to accept forwarded email)
- GitHub Issues
- Home Assistant
- Apple Photos
- Google Photos
# Mobile app specific functions
When creating a track through the mobile app as much telemetry as reasonable should be captured
## Track Telemetry
- Photo/GIF/Video
	- Compression (reduce file size for transmission and tokenizer)
	- Selection of non blurry frames (accelerometer or image analysis)
	- Location the user tapped in the frame to capture the scene
- Audio
	- Transcription of Audio (generated on device)
	- Basic signal analysis e.g. FFT converted to text for LLM (on device)
- GPS
	- Try to also get uncertainty
	- Try to get elevation
- Address estimation
- Magnetometer
	- Direction of camera
- Accelerometer 
	- Direction of camera
- Barometer (not on all devices)
	- Elevation
- WiFi antenna (optional)
	- Current network
	- Proximal networks
## Native track generation from device sensors
1. the app always opens to the live view finder of the capture screen
	1. optionally swipe on the view finder to switch lenses
	2. if the app detects low light a flashlight button appears that the actor can trigger to turn on the device flashlight
	3. tap anywhere in the view finder to capture a track
	4. during a capture, a loading circle appears taking ~5 seconds to complete, in that time:
		1. a photo is taken at the moment of the tap
		2. the microphone starts recording for the duration of the loading circle
		3. a shutter button appears for the duration of the loading circle that allows the actor to add additional photos to the track
				1. if the actor holds the shutter button down the capture session will extend until the button is released. photos will be taken every half a second while the button is pressed.
		4. a delete button appears for the duration of the loading circle that allows the actor to abort the capture session
		5. supplementary telemetry is taken (ideally in parallel as GPS sometimes takes a bit)
		6. the user can tap anywhere on the view finder to complete the capture session early
	5. the actor can navigate to view the screen from a different entity they are part of
# General functionality across web and mobile apps
1. The actor can navigate to the capture screen
	1. the actor can click the "+" button to upload a track via pasting/writing in a text block, uploading a compatible document, or upload a photo.
	2. the actor can navigate to view the screen from a different entity they are part of
2. The actor can navigate to the queue screen from the navigation bar
	1. the queue screen shows tasks being performed by other actors as a result of their tracks or answers
	2. the queue screen prominently displays any questions that need approval that are assigned to the actor
	3. if the actor is accountable to the task a question is attached to they can also answer that 
	4. if they are an entity admin they can see all questions that have been tasked in the entity and answer them
	5. the actor can navigate to view the screen from a different entity they are part of
3. The actor can navigate to the task screen using the navigation bar
	1. the actor can select pre-made filters or custom ones such as 
		1. "my tasks" to view tasks where they are responsible
		2. "to buy" to view tasks that require purchasing resources
		3. "grocery" to view tasks that are tagged with grocery
		4. "meal"
	2. tasks are grouped by solution showing only the next available tasks for the solution
		1. if a solution to the goal make a meal for Sunday dinner is make shepherd's pie and it has been identified that potatoes need to be acquired the next step would be "buy golden potatoes" and it would not show the successor tasks as those cannot be preformed without potatoes
		2. task groups can be expanded or contracted to show all tasks either by individual solution for all solutions
	3. the actor can click the checkbox next to the solution to mark all tasks in the solution complete
	4. the actor can click on the checkbox next to a task to mark it complete
	5. the actor can swipe right on the either a solution or a task to use a photo to mark it complete
		1. the moment the capture session ends the screen would return to the users location in the task screen
	6. marking a task like acquire 3lb of potatoes complete would reveal the next task in the solution and add 3lb of potatos to the entity's inventory
	7. the actor can swipe left on a task or solution to mark it as not attempting or blocked
		1. depending on the permissions this would remove the task or solution or kick-off a question task to the accountable or admin actor for the task to confirm it.
	8. certain tasks may have a "buy" button that would display a solution to replace that task and any additional qualifying tasks 
	9. the actor can add a task under a solution or independent of one
		1. This is treated as a track not a task and another task, likely assigned to an AI actor is assigned where it is parsed and linked into the Entity (to a solution, inventory, etc.)
		2. If there is ambiguity in the parsing of the track into a task questions or changes can be sent to the user for resolution via the queue
	10. the actor can click the select button allowing them to select multiple tasks 
		1. If the select button is clicked
			1. a select all button appears
			2. an export button appears 
			3. a delete button appears
		2. Once one or more tasks are selected
			1. the export and delete buttons are no longer grayed out
		3. If the select all button is clicked it changes to the deselect all button
	11. the actor can navigate to view the screen from a different entity they are part of
4. The actor can navigate to the entity screen via the navigation bar
	1. the actor can select pre-made filters or create custom ones such as:
		1. active goals
		2. past goals
		3. community favorites
		4. solutions with rice as a resource
		5. entity favorites
	2. the actor can select goals to initiate
	3. the actor can select goals to pause or terminate
	4. the actor add goals or solutions
		1. This is treated like a track and generates a task likely assigned to an AI actor to link it into the Entity
			1. any ambiguity or approvals are sent to the approval queue
	5. the actor can edit goals or solutions
	6. the actor can select favorite goals or solutions
	7. the actor can view inventory of the entity
	8. the actor can modify inventory of the entity
	9. the actor can generate tasks to procure items from inventory of the entity
		1. This generates a task to procure the item for the entity
			1. The task is pre linked to the inventory item so if it is completed it will add the quantity to the inventory
	10. the actor can select pre-made questions attached to inventory items such as (depending on the actor's permission these would be de facto approved and a task would be generated to procure the resource, otherwise it would get approved by an actor with proper permissions):
		1. "may we add this to the as a to buy task?"
		2. "are we sure the quantity is correct?"
	11. the actor can navigate to view the screen from a different entity they are part of
5. the actor can navigate to the menu by clicking the hamburger button in the upper right of the screen
	1. the actor can manage their presence in the entities they are a part of 
	2. the actor can manage the entities they are admins of
		1. delete the entity
		2. add, remove, or manage the permissions of actors in the entity
		3. whitelist or blacklist goals, lenses, and solution from the entity
		4. add, edit, or remove locations 
		5. add, edit, or remove rules
			1. e.g. how many accountable actors need to approve a task or solution deletion (1, majority, or consensus)
	3. the actor can create an entity
# state machine
## **Goal**
### **Conventions**

- Any transition not listed is **invalid** (return 409 / “illegal transition”).
- “Actions” are side effects triggered by the transition (often: emit domain events, create Questions, create ChangeSets).
- “Guards” are required predicates (auth, version checks, schema checks).

---

## **Track transition table**

|**Current state**|**Event**|**Next state**|**Guards**|**Actions**|
|---|---|---|---|---|
|CAPTURED|ingest|INGESTED|entity_id present|freeze raw payload; store immutable blob pointer; normalize telemetry|
|INGESTED|enqueue_analysis|QUEUED_FOR_ANALYSIS|lens binding exists OR default lens allowed|create Task(type=ANALYZE_TRACK) for assigned analyst actor|
|QUEUED_FOR_ANALYSIS|analysis_started|QUEUED_FOR_ANALYSIS|(idempotent)|write lens_run log (RUNNING)|
|QUEUED_FOR_ANALYSIS|analysis_succeeded|ANALYZED|lens_run=SUCCEEDED|attach produced ChangeSet ids; attach proposed links (unconfirmed)|
|QUEUED_FOR_ANALYSIS|analysis_failed|INGESTED|lens_run=FAILED|record error; optionally create Task(type=MANUAL_REVIEW)|
|ANALYZED|request_clarification|NEEDS_CLARIFICATION|questions produced|create Question(s) + Task(s) to answer them|
|NEEDS_CLARIFICATION|clarification_resolved|ANALYZED|all required questions ANSWERED|attach Answer ids; allow re-run or proceed|
|ANALYZED|link_finalized|LINKED|at least one link confirmed OR explicit “no link” decision|persist Track↔Goal/Lens links with link_type=confirmed/rejected|
|LINKED|archive|ARCHIVED|retention/policy ok|remove from default feeds; keep audit|
|*|archive|ARCHIVED|retention/policy ok|same|

---

## **LensRun transition table**

|**Current state**|**Event**|**Next state**|**Guards**|**Actions**|
|---|---|---|---|---|
|CREATED|start|RUNNING|worker lease acquired|record processor_type/model_version; start timer|
|RUNNING|succeed|SUCCEEDED|outputs schema-valid|write outputs: ChangeSet(s), suggested links, Questions (as part of ChangeSets)|
|RUNNING|fail|FAILED|—|record failure + error blob|
|RUNNING|cancel|CANCELED|caller has cancel rights|stop work; record cancellation|

---

## **ChangeSet transition table**

|**Current state**|**Event**|**Next state**|**Guards**|**Actions**|
|---|---|---|---|---|
|(none)|propose|PROPOSED|diff schema-valid|record base_snapshot_version; provenance; risk classification|
|PROPOSED|require_approval|NEEDS_APPROVAL|policy says “approval required”|create Question(s) + Task(s) to answer; enqueue|
|PROPOSED|auto_approve|APPROVED|policy says “auto-approve ok”|emit “approved” event|
|NEEDS_APPROVAL|approve|APPROVED|approver authorized; threshold met|close related Questions (answered); emit “approved”|
|NEEDS_APPROVAL|reject|REJECTED|rejector authorized|expire related Questions; emit “rejected”|
|APPROVED|start_apply|APPLYING|applier authorized|lock target rows (or equivalent); begin transaction|
|APPLYING|apply_succeeded|APPLIED|all writes succeeded|commit; emit domain events; materialize derived views; optionally create downstream Tasks included in diff|
|APPLYING|apply_needs_rebase|NEEDS_REBASE|base_snapshot_version mismatch|abort txn; create Task(type=REBASE_CHANGESET)|
|APPLYING|apply_failed|FAILED|—|abort txn; record error; create Task(type=MANUAL_REVIEW)|
|NEEDS_REBASE|rebase_to_new|PROPOSED|new diff schema-valid|write new base_snapshot_version; link parent_changeset_id|
|PROPOSED/NEEDS_APPROVAL/APPROVED|supersede|SUPERSEDED|newer changeset declared winner|expire Questions; emit “superseded”|
|FAILED|supersede|SUPERSEDED|newer changeset exists|same|

Terminal states: **APPLIED, REJECTED, SUPERSEDED** (and typically FAILED unless you allow repair).

---

## **Question transition table**

|**Current state**|**Event**|**Next state**|**Guards**|**Actions**|
|---|---|---|---|---|
|(none)|open|OPEN|typed schema valid|assign to responsible/accountable set; enqueue|
|OPEN|claim|CLAIMED|actor eligible|set claimed_by + lease timeout|
|CLAIMED|release|OPEN|claimer or admin|clear claimed_by|
|OPEN/CLAIMED|answer|ANSWERED|answering Task authorized; value type-valid|create Answer(row) linked to that Task; notify parent ChangeSet|
|OPEN/CLAIMED|expire|EXPIRED|parent ChangeSet SUPERSEDED/REBASED|mark stale; hide from queue|
|OPEN/CLAIMED|cancel|CANCELED|admin/policy|close without answer|

Terminal: **ANSWERED, EXPIRED, CANCELED**.

---

## **Task transition table**

|**Current state**|**Event**|**Next state**|**Guards**|**Actions**|
|---|---|---|---|---|
|(none)|create|DRAFT|creator authorized|initialize task fields; attach entity scope|
|DRAFT|publish|READY|required fields present (assignee/roles, type)|emit “task_ready”; show in feeds|
|READY|start|IN_PROGRESS|actor eligible|set started_at; optionally lock lease|
|IN_PROGRESS|wait_on_input|WAITING_ON_INPUT|missing info identified|create Question Task(s) / ping consulted actors|
|WAITING_ON_INPUT|input_received|IN_PROGRESS|required Questions answered|resume|
|IN_PROGRESS|block|BLOCKED|reason provided|set blocked_reason; optionally spawn escalation Question|
|BLOCKED|unblock|IN_PROGRESS|blocker cleared|resume|
|IN_PROGRESS|complete|COMPLETED|completion criteria met|set completed_at; if produces ChangeSet, evaluate pending apply|
|COMPLETED|mark_pending_apply|COMPLETED_PENDING_APPLY|produced ChangeSet not terminal|link pending_changeset_ids|
|COMPLETED_PENDING_APPLY|changeset_resolved|COMPLETED|all pending ChangeSets terminal|clear pending; emit resolution|
|COMPLETED|verify|VERIFIED|verifier authorized|create Verification record (or mark verified)|
|READY/IN_PROGRESS/WAITING_ON_INPUT/BLOCKED|cancel|CANCELED|canceler authorized|set canceled_at; release leases; optionally expire Questions|
|*|archive|ARCHIVED|retention/policy ok|hide from default views|

Notes (important invariants):

- Completing a Task **never directly mutates entity state** unless it triggers a ChangeSet apply path (auto-apply or approval+apply).
    
- “Apply ChangeSet” should itself be a **Task type** that drives the APPROVED → APPLYING → APPLIED transitions.
    

---

## **Execution transition table (for Step→Task idempotence)**

| **Current state**     | **Event** | **Next state** | **Guards**                       | **Actions**                                                       |
| --------------------- | --------- | -------------- | -------------------------------- | ----------------------------------------------------------------- |
| (none)                | plan      | PLANNED        | solution chosen                  | create execution record; bind goal/solution; snapshot constraints |
| PLANNED               | activate  | ACTIVE         | approval satisfied (if required) | create Step-backed Tasks with unique (execution_id, step_id)      |
| ACTIVE                | pause     | PAUSED         | actor authorized                 | stop scheduling; keep tasks                                       |
| PAUSED                | resume    | ACTIVE         | actor authorized                 | resume scheduling                                                 |
| ACTIVE                | complete  | COMPLETED      | all required tasks terminal      | set completed_at; optionally generate “outcome verification” task |
| PLANNED/ACTIVE/PAUSED | cancel    | CANCELED       | actor authorized                 | cancel remaining tasks per policy                                 |

Terminal: **COMPLETED, CANCELED**.
# Repo founding contract
## **Goal**
Make the repo the **source of truth** for safety + CI/CD gates (on GitHub), so “auditability” replaces “tribal knowledge” and dashboard foot-guns.
```
Repo Charter (v0)
Principles
1) Repo is authoritative: any behavior that matters must be visible as code, config, or tests.
2) Proposals vs Truth: only ChangeSet apply mutates truth; all other writes are proposals.
3) Safety by default: dangerous actions require explicit approval paths and leave audit trails.
4) Every invariant is enforced twice: (a) DB constraints/migrations, (b) CI tests.
5) Changes are reviewable: policy, schema, and event contracts require code review and mandatory checks.
6) No “magic”: anything that can affect data, security posture, or external side effects must be representable as a Task/ChangeSet and emitted as events.
Non-negotiables
- All migrations are in-repo and run in CI on a clean DB.
- Event schemas are in-repo, versioned, and validated in CI.
- Authorization rules are in-repo and tested in CI.
- Secrets never in repo; secrets injected by deployment; logs/events never include raw secret material.
- Dashboard-only configuration is treated as an exception: documented + drift-checked + mirrored into repo when possible.
Change control rules (auditing-first)
A) Schema changes
- Any change to prisma schema must include: migration + verify script + invariants tests.
- Expand/contract only; destructive changes require a two-step deprecation cycle.
B) Event changes
- Additive changes only within an event version.
- Breaking changes require new event_type version suffix (v2) and explicit migration notes.
- Every event field must have a PII classification.
C) Policy changes
- Any policy change requires policy tests proving at least:
  - cross-entity isolation
  - role-based access constraints
  - approval thresholds and “apply” restrictions
D) External effects (Jira etc.)
- Only allowed via Integration Effect Tasks; always idempotent via dedupe_key.
- Production effect execution requires explicit allowlist config in repo.
Operational posture
- All state transitions are performed via API commands that emit events via outbox.
- Workers only act on persisted commands/events (no hidden side effects).
```
### **“Dashboard-minimal” on GitHub is realistic—here’s how**
You can’t eliminate **all** GitHub UI (branch protection is inherently a GitHub setting), but you _can_ make it auditable and code-driven by doing two things:
1. **Put the policy in repo** (and enforce it via required checks)
2. **Manage GitHub settings “as code”** so drift becomes visible (and optionally auto-corrected)
The key is: **no one needs to remember the rules**. The repo + CI makes the rules unavoidable.
---
## **1) GitHub settings as code (branch protection, required checks, CODEOWNERS)**
Use one of these (both are “less dashboardy” and auditable):
- **Terraform GitHub Provider**: stores branch protection, required checks, environments, secrets references (not values), etc. in infra/github/
- **Probot Settings** (or similar “GitHub settings” app): reads .github/settings.yml and applies it
Terraform is more explicit and auditable long-term; Probot is simpler to bootstrap.
```
Recommended: Terraform for GitHub settings
- infra/github/main.tf defines:
  - branch protection (main)
  - required status checks (ci / migrations / policy / events / tests)
  - required reviews + CODEOWNERS enforcement
  - “dismiss stale approvals”
  - “require conversation resolution”
- CI runs “terraform plan” on PRs (audit)
- A privileged workflow runs “terraform apply” on merges (controlled)
```
---
## **2) CI gates that prevent foot-guns by construction**
Here’s the shape of the gates (all explicit, repo-defined):
### **Required checks (suggestion)**
- lint
- typecheck
- unit-tests
- db-migrate-and-verify
- policy-tests
- event-schema-validate
- security-scan (SAST + dependency audit)
- dangerous-change-detector (custom script)
And make them **required** on main.
---
## **3) A concrete GitHub Actions setup (explicit in repo)**
### **.github/workflows/ci.yml**
This runs deterministically using ephemeral Postgres and fails PRs that violate invariants.
```
name: ci
on:
  pull_request:
  push:
    branches: [ main ]
jobs:
  lint_typecheck_test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r lint
      - run: pnpm -r typecheck
      - run: pnpm -r test
  db_migrate_and_verify:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_USER: postgres
          POSTGRES_DB: app
        ports: [ "5432:5432" ]
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 20
    env:
      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/app
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r db:generate
      - run: pnpm -r db:migrate:deploy
      - run: pnpm -r db:seed:ci
      - run: pnpm -r db:verify
  event_schema_validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r events:validate
      - run: pnpm -r events:codegen:check
  policy_tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r policy:test
  dangerous_change_detector:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - run: node scripts/ci/dangerous-change-detector.mjs
```
---
## **4) The “dangerous change detector” (auditing-first, not skill-first)**
This is the single best “anti-foot-gun” pattern: make CI **refuse** changes unless the right companion artifacts exist.
Examples of rules:
- If schema.prisma changed → require a new migration folder.
- If any event schema changed → require version bump + regenerated types checked in.
- If policy files changed → require policy tests changed or at least policy test suite runs (it will).
- If a migration is destructive (DROP/TRUNCATE) → require an explicit MIGRATION_RISK_ACK.md entry.
```
scripts/ci/dangerous-change-detector.mjs rules (examples)
- Detect prisma schema diff -> ensure prisma/migrations has new timestamped folder
- Detect packages/events/catalog changes -> ensure:
  - event_version bumped OR new v2 schema added
  - packages/events/generated is updated (or codegen check passes)
- Detect infra/github changes -> ensure terraform fmt + plan job runs (if you choose terraform)
- Detect SQL migration containing "DROP TABLE" -> require docs/adr or MIGRATION_RISK_ACK update
```
This is exactly “avoid foot guns by auditing.”
---
## **5) CODEOWNERS + review enforcement (low dashboard dependence)**
Even though GitHub toggles “require CODEOWNERS review” in UI, CODEOWNERS itself lives in repo and is auditable.
```
.github/CODEOWNERS (suggestion)
- /packages/policy/ @core-security
- /packages/events/catalog/ @core-platform
- /packages/db/prisma/ @core-platform
- /prisma/migrations/ @core-platform
- /infra/github/ @core-platform
```
Pair with branch protection:
- require 1–2 reviews
- require CODEOWNERS
- require status checks
Then you’re not relying on personal discipline.
---
## **6) Environments without dashboard drift**
For GitHub Deployments/Environments, you can still keep it code-first:
- Define env names in Terraform (or settings-as-code)
- Keep runtime config in repo:
    - config/runtime.public.json
    - config/policy.defaults.json
- Secrets come from:
    - GitHub Encrypted Secrets (still a UI, but manageable via GH CLI/terraform) or
    - a real secrets manager (AWS/GCP/1Password) with OIDC from GitHub Actions
Best practice for “least dashboardy”:
- GitHub Actions uses **OIDC** to fetch secrets at runtime; nothing is manually pasted into GitHub after initial bootstrap.
# project backend
Make the backend feel like a **high-leverage, low-friction “platform repo”**: declarative, reproducible, auditable, observable, migration-safe, and pleasant to extend—so features feel easy, not scary.
---
## **Opinionated architecture that fits your requirements**
- **Postgres + Prisma** for the system of record (schema + migrations in repo, great DX).
- **API: Fastify + tRPC** (or REST + OpenAPI) running in Node.
    - tRPC is _very_ vibe-code friendly (types flow end-to-end).
    - If you want external developers / integrations, add **OpenAPI** alongside or later.
- **Outbox-driven events** in Postgres (table + worker) → publish to **Redis Streams** or **NATS** (or start with a “DB-backed event log + polling” and swap later).
- **Auth as an adapter** (Clerk) with your own policy layer in-code.
- **Authorization as code** using either:
    - **Oso** (policy language, repo-defined, good for ABAC), or
    - **Casbin** (RBAC/ABAC, widely used), or
    - fully in TypeScript with a small policy DSL (surprisingly viable early).
- **Observability: OpenTelemetry** everywhere (logs + traces + metrics), export to whatever later.
This gives you: strong schema governance, an event spine, pluggable auth, and a repo that “tells the truth.”# **“Awesome repo to work in” blueprint**
## **1) Repo layout that makes intent obvious**
Monorepo, but not a mess:
- apps/api – Fastify server, tRPC/REST routes, auth adapter, policy enforcement
- apps/worker – outbox/event publisher, async jobs, replays, projections
- packages/db – Prisma schema, migrations, seed + fixtures, DB test helpers
- packages/policy – authorization rules + tests (no DB access)
- packages/events – event catalog JSON schemas, TypeScript types, validators, PII rules
- packages/contracts – API contracts (tRPC routers or OpenAPI schemas)
- packages/observability – OTEL setup + log redaction utilities
- infra/ – docker compose, k8s/terraform if you go there later, env templates
- docs/adr – architecture decision records (short, durable)
This separation is huge for “features don’t feel daunting.”
---
## **2) Make the backend declarative by default**
Concrete patterns that enforce your Core Requirements:
### **“Config-as-code” targets**
- **Auth config**: config/auth.providers.json (and adapters read it)
- **Policy config**: packages/policy/*.policy or .ts DSL + tests
- **Event catalog**: packages/events/catalog/*.json
- **PII classification rules**: packages/events/pii.rules.ts
- **CORS / origins / redirect URIs**: config/runtime.public.json committed
- **Environments**: env/.env.example, env/dev.env, env/staging.env (no secrets)
### **“No dashboard drift” enforcement**
- A CI job that runs:
    - migrations apply in ephemeral DB
    - policy tests
    - event schema validation
    - (optional) “drift check” scripts for providers that allow export
---
## **3) Event catalog as code (with enforcement)**
You already have the catalog content. The step that makes it “production repo awesome”:
- Store **JSON Schema per event** in repo.
- Generate:
    - TS types
    - runtime validators (Ajv)
    - documentation pages
- Require in CI:
    - “no event emit without schema”
    - “no schema change without version bump”
    - “PII flags declared for every field”
This yields confidence and makes integrations (Jira) easy later.
---
## **4) The outbox pattern makes reliability feel effortless**
Make DB writes and event emission one atomic story:
- In the same transaction where you apply a ChangeSet or update Task state:
    - insert into event_outbox
- Worker reads outbox and publishes to:
    - event_log table (immutable append-only, per entity order)
    - and optionally a broker (Redis/NATS)
- Consumers build projections (approval queue, task list, inventory view)
This is what turns your system into a platform, not “a bunch of endpoints.”
---
## **5) Authorization that won’t rot**
To keep “auditable security” without drowning in complexity:
### **Recommendation: start with app-layer policy, but structure it like RLS**
- A single policy function:
    - can(actor, action, resource, context) -> allow/deny
- All DB reads go through a small set of “data access functions” that:
    - fetch minimal data
    - call policy in one place
- Add **policy tests** like:
    - “Contributor cannot read Tracks in other Entity”
    - “Accountable can approve ChangeSets”
Later, if you want, you can introduce Postgres RLS for the most sensitive tables (Tracks, memberships) without rewriting everything, because your policy model is already crisp.
Tools that help:
- **Oso** if you want a policy language and strong auditing.
- **Casbin** if you want simpler RBAC with ABAC extensions.
- Or a TS DSL if you want maximum approachability.
---
## **6) Migration safety that doesn’t slow development**
This is where “feature-dread” comes from, so make it boring:
### **A strict migration protocol**
- Every migration includes:
    - forward SQL
    - a “verify” script (assertions)
    - a rollback (when feasible) or a documented “forward-only with compensating migration”
- Use “expand/contract”:
    1. add new columns nullable
    2. dual-write
    3. backfill via worker job
    4. switch reads
    5. drop old columns later
### **CI gates**
- Spin up Postgres in CI
- Apply migrations
- Run seed
- Run invariants tests (uniques like (execution_id, step_id))
- Run “policy tests”
- Run “event emission tests” (events valid against schemas)
This makes migration work safe and routine.
---
## **7) Observability that’s baked-in and safe**
Make OTEL a library that nobody can “forget”:
- packages/observability exports:
    - logger with automatic redaction
    - tracer middleware for Fastify
    - metrics helpers
- Default logs are structured JSON with:
    - entity_id, task_id, changeset_id, event_id, request_id
- Explicit PII redaction:
    - event payloads never include raw Track content
    - logs never include tokens/secrets
    - Track blobs are referenced, not embedded
---
## **Tooling wishlist to make this repo Delightful**
### **DX + correctness**
- **TypeScript everywhere**, zod for input validation (pairs well with tRPC).
- **Biome** or **ESLint + Prettier** (Biome is fast and simple).
- **Vitest** for tests, **Testcontainers** for integration tests with Postgres.
- **Docker Compose** for local: api + worker + postgres + redis/nats + otel-collector.
- **Task runner**: just or make or pnpm scripts (pick one, keep it simple).
- **TurboRepo** (or Nx) if you want caching/monorepo ergonomics.
### **Platform safety**
- **Semantic PR checks**:
    - if schema.prisma changes → require migrations/ changes
    - if packages/events/catalog changes → require version bump + generated types updated
    - if packages/policy changes → require policy tests updated
### **Docs that prevent fear**
- docs/architecture.md (short)
- docs/dev-setup.md (one command)
- docs/how-to-add-a-feature.md (copy/paste checklist)
- docs/adr/0001-event-spine.md, 0002-policy.md, etc.
---
**Prisma + Postgres + outbox events + OTEL + policy-as-code** is the cleanest foundation.

# Q&A
## **1) Can a Task be “completed” without applying its ChangeSet?**
**Proposed answer:** Yes — but only if the task has **no pending ChangeSet**, or its ChangeSet is **explicitly rejected/superseded**.
**Rule set that dovetails well:**
- A Task can produce **0..n ChangeSets** (often 0 or 1).
- “Task completion” means: _the responsible actor is done with their work_.
- “ChangeSet application” is a separate state transition: _the Entity state changed_.
- If a Task produced a ChangeSet that is still proposed|needs_approval|approved, the Task cannot be “fully closed”; it becomes **completed_pending_apply** (or similar).
- The system should surface these as “needs your review / needs apply” in the queue.
**Why it works**
- End user: avoids confusion (“I finished reviewing the pantry photo” even if they haven’t accepted the diff).
- Tech: clean separation of responsibilities; avoids implicit writes.
- Scale: supports multiple approval policies and future automations.
---
## **2) Can a ChangeSet spawn Tasks that spawn more ChangeSets before approval?**
**Proposed answer:** Yes, but only through a **controlled “proposal chain”** with strict boundaries.
**Boundaries**
- A ChangeSet may include **proposed Tasks** (draft tasks).
- Draft tasks can run **analysis-only** and produce **additional proposed ChangeSets**, but:
    - they cannot **apply** any ChangeSet
    - they cannot call external integrations without an explicit Approval-gated Task
- The chain must be explicit via parent_changeset_id and origin_task_id, so an auditor can trace the lineage.
**Practical cap (for safety + simplicity)**
- Introduce a policy like max_proposal_depth (default 2–3) to prevent runaway loops.
- If exceeded, system creates a Question: “Continue planning?” (human checkpoint)
**Why it works**
- End user: planning can refine itself without spamming approvals prematurely.
- Tech: prevents “AI recursively edits the world”.
- Scale: supports sophisticated planning later (meal plans → grocery list → recipes → prep steps).
---
## **3) What happens when two analysts propose conflicting ChangeSets against the same inventory items?**
**Proposed answer:** Inventory uses **intent-based operations + optimistic concurrency**, not blind overwrites.
**Key design choice**
Treat inventory changes as _events with intent_ (set, add, consume) that resolve into current state, rather than raw “update quantity to X”.
### **Inventory operation types**
- SET_STOCK(resource, location, quantity, evidence)
    Used for “I saw this in the pantry photo”.
- ADJUST_STOCK(delta)
    Used for manual corrections / counting.
- CONSUME_STOCK(delta, linked_task_id)
    Used when cooking tasks complete.
- PROCURE_STOCK(delta, vendor/order ref)
    Used when a procurement task completes.
### **Conflict handling**
- Each ChangeSet references the **inventory snapshot version** it was computed against.
- On apply:
    - If the snapshot version matches: apply normally.
    - If it doesn’t match: the apply task transitions to **needs_rebase** and auto-generates a diff Question:
        - “Inventory changed since this was proposed. Recompute proposal?”
        - Usually: rerun the lens on latest state and show a merged diff.
**Why it works**
- End user: avoids “my pantry keeps flipping”.
- Tech: minimizes merge hell.
- Scale: supports multiple collaborators + multiple sensors + repeated captures.
---
## **4) How do we prevent duplicate Tasks when Tasks are regenerated from Steps?**
**Proposed answer:** Make Step→Task creation **idempotent** via an execution instance.
**Model tweak**
- Introduce **Execution** (or PlanRun) as a first-class record:
    - execution_id = “this time we are cooking Chili on Sunday”
- For each Step in the Solution:
    - create Task with (execution_id, step_id) unique constraint
- If planning reruns, it can:
    - create a **new execution_id** (new run), or
    - reuse the same execution_id and “edit” via a ChangeSet that proposes task edits (reschedule, reassignment) instead of duplicating.
**Why it works**
- End user: tasks don’t duplicate when you tweak a plan.
- Tech: simple DB invariant.
- Scale: supports recurring meals, template solutions, and collaboration.
---
## **5) Should Task completion automatically apply inventory updates (e.g., “buy potatoes” adds potatoes)?**
**Proposed answer:** Yes, but only via a **deterministic, typed “effects” system** that is still applied as a ChangeSet.
**Mechanism**
- Certain task types carry **declared effects** (like a tiny transaction script):
    - PROCURE(resource_id, qty, location_id)
    - CONSUME(resource_id, qty, location_id)
- When user marks task complete:
    1. system generates an **effects ChangeSet** (or activates a precomputed one)
    2. if policy allows “auto-apply low-risk effects”, it applies immediately
    3. otherwise it lands in approval queue
**Policy knobs (important for scalability)**
- auto-apply allowed when:
    - low cost
    - no deletions
    - high confidence
    - user is accountable
- else require approval
**Why it works**
- End user: “checking off buy potatoes” updates pantry like magic.
- Tech: still auditable + reversible.
- Scale: later supports vendor receipts, invoices, integrations.
---
## **6) Can a Goal be satisfied without explicitly attaching Tracks to it first?**
**Proposed answer:** Yes — Track→Goal linkage is **inferred and revisable**, not mandatory at capture time.
**Policy**
- Tracks start unattached except for coarse defaults (e.g., “Meals” entity scope).
- Lenses propose:
    - track_goal_links (with confidence and rationale)
    - or ask a minimal question when ambiguous
- Track↔Goal is many-to-many, but each link has:
    - link_type (inferred, confirmed, rejected)
    - created_by (lens_run/manual)
    - confidence
    - evidence_refs
**Why it works**
- End user: minimal friction at capture.
- Tech: supports multiple interpretations (a receipt could be meals + expenses).
- Scale: enables global search and queryability.
---
## **7) Do we store “solution eliminated by answer” or recompute?**
**Proposed answer:** Recompute, but cache **explanations** and store only stable constraints.
**Design**
- Answers update a canonical **Constraints** object on the Goal/Execution:
    - e.g., dietary restrictions, budget, time window, allergens, preferences
- Planning evaluates solutions against constraints on demand.
- Store:
    - chosen solution(s)
    - and a short “why” explanation snapshot for user trust
- Do **not** store a permanent “eliminated” list (it becomes stale fast).
**Why it works**
- End user: system stays adaptive.
- Tech: avoids stale derived data.
- Scale: makes planning engine pluggable.
---
## **8) Location model: tree or DAG?**
**Proposed answer:** **Tree for canonical containment**, with optional “tags/aliases” for cross-cutting views.
**Canonical**
- location.parent_id forms a tree (fast, simple, predictable UI).
**Cross-cutting needs**
- Add location_labels or location_aliases for things like:
    - “kitchen zone”, “near stove”, “shared pantry”
- Sensors can attach both:
    - canonical location_id
    - plus labels (optional)
**Why it works**
- End user: location browsing feels normal.
- Tech: simpler permissions + queries.
- Scale: you still get flexibility without DAG complexity.
---
## **9) What do Tasks reference: Resource, InventoryItem, or both?**
**Proposed answer:** Both — but with a clean split:
- **Resource** = “type of thing”
- **InventoryItem** = “specific stock at a location”
**Rules**
- Procurement tasks reference **Resource** (you don’t yet have the stock).
- Consumption and “use what we have” tasks reference **InventoryItem** _when known_, else Resource + preferred location.
- Recipe steps reference **Resource requirements**; execution binds them to specific InventoryItems at runtime (reservation/commit pattern if you want).
**Why it works**
- End user: tasks work even if inventory isn’t perfect.
- Tech: avoids circular dependencies.
- Scale: enables substitution (“any pasta”) and later vendor SKU mapping.
---
## **10) How do we keep “one-click outsource” possible later without building it now?**
**Proposed answer:** Model outsourcing as a **first-class assignment and capability boundary**, not a special workflow.
**Minimal architecture hooks now**
- Actor has:
    - type (human, ai, vendor)
    - capabilities (what actions they can take)
    - trust level / verification
- Tasks support:
    - R/A/C/I roles + optional “external_visibility” field (what the assignee can see)
- External actions are done only by **Integration Tasks** (even if not implemented yet):
    - “Create Jira ticket” is a Task type whose effect is “call Jira API”
    - Always approval-gated by policy
This makes Jira linking straightforward for third parties without you shipping vendor marketplaces.
---
## **The cohesive picture (why these answers dovetail)**
- **Everything meaningful is a Task or a ChangeSet**, but they are decoupled enough to support approvals, chaining, and integrations.
- **Inventory is event/intention based**, so concurrency and collaboration won’t destroy correctness.
- **Execution_id makes planning and task generation idempotent**, which is essential for extensibility.
- **Constraints become the durable product of Questions**, letting planning remain pluggable and queryable.
- **Permissions and external effects remain policy-gated**, keeping you safe while still extensible.
  