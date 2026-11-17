# Near-Duplicate Investigation

The Phase 1 SimHash count is a broad candidate signal, not a verified clone count. Its canonicalization replaces every identifier, number, and string, so short boilerplate and common control-flow shapes can collide.

- Candidate pairs examined: 1,878,290
- Broad SimHash pairs (Hamming distance <=3): 114,609
- Cross-original-split broad pairs: 36,723
- Verified clone edges: 11,213
- Cross-original-split verified edges: 3,356
- Multi-row connected components: 3,571
- Largest component: 42

## Representative pairs

### verified_clone

- Left: {'split': 'train', 'index': 9335, 'language': 'JavaScript'}
- Right: {'split': 'train', 'index': 11481, 'language': 'JavaScript'}
- SimHash distance: 0
- Raw token 5-gram Jaccard: 1.0
- Left excerpt: `exports.getWindowSize = function() {   if ('innerHeight' in global) {     return [global.innerHeight, global.innerWidth];   } else {     // In a Web Worker, the DOM Window is not available.     return [640, 480];   } };`
- Right excerpt: `exports.getWindowSize = function(){   if ('innerHeight' in global) {     return [global.innerHeight, global.innerWidth];   } else {     // In a Web Worker, the DOM Window is not available.     return [640, 480];   } };`

### verified_clone

- Left: {'split': 'train', 'index': 16739, 'language': 'C'}
- Right: {'split': 'train', 'index': 17640, 'language': 'C'}
- SimHash distance: 0
- Raw token 5-gram Jaccard: 1.0
- Left excerpt: `static int search_old_relocation (struct reloc_struct_t *reloc_table, 				  ut32 addr_to_patch, int n_reloc) { 	int i; 	for (i = 0; i < n_reloc; i++) { 		if (addr_to_patch == reloc_table[i].data_offset) { 			return i; 		} 	} 	return -1; }`
- Right excerpt: `static int search_old_relocation(struct reloc_struct_t *reloc_table, ut32 addr_to_patch, int n_reloc) { 	int i; 	for (i = 0; i < n_reloc; i++) { 		if (addr_to_patch == reloc_table[i].data_offset) { 			return i; 		} 	} 	return -1; }`

### verified_clone

- Left: {'split': 'train', 'index': 14955, 'language': 'JavaScript'}
- Right: {'split': 'validation', 'index': 1596, 'language': 'JavaScript'}
- SimHash distance: 0
- Raw token 5-gram Jaccard: 1.0
- Left excerpt: `context.suiteSetup = function(fn) {       suites[0].beforeAll(fn);     };`
- Right excerpt: `context.suiteSetup = function(fn){       suites[0].beforeAll(fn);     };`

### verified_clone

- Left: {'split': 'train', 'index': 7462, 'language': 'JavaScript'}
- Right: {'split': 'train', 'index': 12842, 'language': 'JavaScript'}
- SimHash distance: 0
- Raw token 5-gram Jaccard: 1.0
- Left excerpt: `function md(a,b,c) {var d=a+" ";switch(c) {case"m":return b?"jedna minuta":"jedne minute";case"mm":return d+=1===a?"minuta":2===a||3===a||4===a?"minute":"minuta";case"h":return b?"jedan sat":"jednog sata";case"hh":return d+=1===a?"sat":2===a||3===a||4===a?"sata":"sati";case"dd":return d+=1===a?"dan"`
- Right excerpt: `function md(a,b,c){var d=a+" ";switch(c){case"m":return b?"jedna minuta":"jedne minute";case"mm":return d+=1===a?"minuta":2===a||3===a||4===a?"minute":"minuta";case"h":return b?"jedan sat":"jednog sata";case"hh":return d+=1===a?"sat":2===a||3===a||4===a?"sata":"sati";case"dd":return d+=1===a?"dan":"`

### verified_clone

- Left: {'split': 'train', 'index': 11586, 'language': 'JavaScript'}
- Right: {'split': 'train', 'index': 14899, 'language': 'JavaScript'}
- SimHash distance: 0
- Raw token 5-gram Jaccard: 1.0
- Left excerpt: `OAuthServer.prototype.start = function(callback) {     this.server = http.createServer((req, res) => {         let data = [],             datalen = 0;         req.on('data', chunk => {             if (!chunk || !chunk.length) {                 return;             }              data.push(chunk);    `
- Right excerpt: `OAuthServer.prototype.start = function (callback) {     this.server = http.createServer((req, res) => {         let data = [],             datalen = 0;         req.on('data', chunk => {             if (!chunk || !chunk.length) {                 return;             }              data.push(chunk);   `

### heuristic_false_positive_or_unverified

- Left: {'split': 'train', 'index': 27315, 'language': 'C++'}
- Right: {'split': 'validation', 'index': 2117, 'language': 'C'}
- SimHash distance: 1
- Raw token 5-gram Jaccard: 0.0
- Left excerpt: `std::wstring CreateUniqueTempDirectory() {     // We need to put downloaded updates into a directory of their own, because     // if we put it in $TMP, some DLLs could be there and interfere with the     // installer.     //     // This code creates a new randomized directory name and tries to creat`
- Right excerpt: `void native_tss_update_io_bitmap(void) { 	struct tss_struct *tss = this_cpu_ptr(&cpu_tss_rw); 	struct thread_struct *t = &current->thread; 	u16 *base = &tss->x86_tss.io_bitmap_base;  	if (!test_thread_flag(TIF_IO_BITMAP)) { 		native_tss_invalidate_io_bitmap(); 		return; 	}  	if (IS_ENABLED(CONFIG_X8`

### heuristic_false_positive_or_unverified

- Left: {'split': 'train', 'index': 16394, 'language': 'C'}
- Right: {'split': 'train', 'index': 18256, 'language': 'C'}
- SimHash distance: 0
- Raw token 5-gram Jaccard: 0.0
- Left excerpt: `error_t lpc546xxEthSendPacket(NetInterface *interface,    const NetBuffer *buffer, size_t offset, NetTxAncillary *ancillary) {    size_t length;     //Retrieve the length of the packet    length = netBufferGetLength(buffer) - offset;     //Check the frame length    if(length > LPC546XX_ETH_TX_BUFFER`
- Right excerpt: `static int ptrace_check_attach(struct task_struct *child, bool ignore_state) { 	int ret = -ESRCH;  	/* 	 * We take the read lock around doing both checks to close a 	 * possible race where someone else was tracing our child and 	 * detached between these two checks.  After this locked check, 	 * we `

### heuristic_false_positive_or_unverified

- Left: {'split': 'train', 'index': 4480, 'language': 'PHP'}
- Right: {'split': 'train', 'index': 24488, 'language': 'Java'}
- SimHash distance: 0
- Raw token 5-gram Jaccard: 0.0
- Left excerpt: `public function isCompiled()     {         return true;     }`
- Right excerpt: `public User getUser() {             return user;         }`

### heuristic_false_positive_or_unverified

- Left: {'split': 'train', 'index': 7105, 'language': 'PHP'}
- Right: {'split': 'train', 'index': 23961, 'language': 'Python'}
- SimHash distance: 2
- Raw token 5-gram Jaccard: 0.0
- Left excerpt: `public function handleElement(&$token) {         if ($token->name !== 'span' || !$token instanceof HTMLPurifier_Token_Start) {             return;         }          // We need to validate the attributes now since this doesn't normally         // happen until after MakeWellFormed. If all the attribu`
- Right excerpt: `def is_authenticated(self, user, password):         # The content of the file is not cached because reading is generally a         # very cheap operation, and it's useful to get live updates of the         # htpasswd file.         with open(self.filename) as fd:             for line in fd:          `

### heuristic_false_positive_or_unverified

- Left: {'split': 'train', 'index': 24603, 'language': 'Java'}
- Right: {'split': 'test', 'index': 187, 'language': 'PHP'}
- SimHash distance: 3
- Raw token 5-gram Jaccard: 0.0
- Left excerpt: `protected String escape(String string) { 		String escaped = JavaEscape.escapeJava(string); 		// escape $ character since it has special meaning in groovy string 		escaped = escaped.replace("$", "\\$");  		return escaped; 	}`
- Right excerpt: `public function testRemoveExtraSlashesWihoutHost()     {         // If the path is starting with more than one "/" and no authority is         // present, the starting slashes MUST be reduced to one.         $uri = (new Uri)->withPath('//foo');         $this->assertSame('//foo', $uri->getPath());   `

## Interpretation

Project-level separation was not possible because the source schema has no repository, project, commit, or file identity. The leakage-controlled split therefore uses conservative verified-clone components. This prevents those detected clone families from crossing partitions but cannot prove absence of same-project or semantic leakage.
