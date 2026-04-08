export interface RujiraContract {
	category: string;
	product: string;
	name: string;
	role: string;
}

export const RUJIRA_CONTRACTS: Record<string, RujiraContract> = {
	'thor15xwa4y4wucma9gmcakjjg7mw36skpuhenhwlh9nkjn8vjguz6xzs8nc8np': {
		category: 'AutoRujira', product: 'AutoRujira',
		name: 'Auto workflow manager', role: 'Workflow manager'
	},
	'thor136rwqvwy3flttm9wfnc5xgnlr6mu5k8e2elgzs2hdhuwf50w3l2q0nu2qu': {
		category: 'CALC', product: 'Recurring Swaps',
		name: 'CALC Manager', role: 'Workflow manager'
	},
	'thor1lhpghazamcsr67y4ehah8pxwyn0s4klyz2qsm8v7wkqylffaja3qrwlct0': {
		category: 'CALC', product: 'Recurring Swaps',
		name: 'Recurring Swaps', role: 'Strategy executor'
	},
	'thor1t2cnyn98xusxakgemsenn2p9n3ykd6accr2c0zg22nczh097ln7qeze20f': {
		category: 'CALC', product: 'Recurring Swaps',
		name: 'CALC Scheduler', role: 'Workflow scheduler'
	},
	'thor1r9wq0ehkef0l27tel9qw8hke2fsqktpxg66rnls32xffypf2htrs6peq6z': {
		category: 'Levana Perps', product: 'Levana Perps',
		name: 'Levana Perps Market - ATOM_USDC', role: 'market'
	},
	'thor1v86dpn86jcftmr6xwmg9ure4fhdxta9n2eup5ag8udw3h7uvmrusqj8whg': {
		category: 'Levana Perps', product: 'Levana Perps',
		name: 'Levana Perps Market - AVAX_USDC', role: 'market'
	},
	'thor1gflccmghzfscmxl95z43v36y0rle8v9x8kvt9na03yzywtw86amsjnq5h2': {
		category: 'Levana Perps', product: 'Levana Perps',
		name: 'Levana Perps Market - BCH_USDC', role: 'market'
	},
	'thor17e5wqwfd6pjm7cdg54vg5xf255gssckgtltew46w50pptk2he92smq4r35': {
		category: 'Levana Perps', product: 'Levana Perps',
		name: 'Levana Perps Market - BNB_USDC', role: 'market'
	},
	'thor1cyd63pk2wuvjkqmhlvp9884z4h89rqtn8w8xgz9m28hjd2kzj2cqwugjkp': {
		category: 'Levana Perps', product: 'Levana Perps',
		name: 'Levana Perps Market - BTC_USDC', role: 'market'
	},
	'thor1cgjnhuf86dnwc6gs8p78x0nmexzht8gpzy9gpv9xh8g03f94vu0q3dpdq2': {
		category: 'Levana Perps', product: 'Levana Perps',
		name: 'Levana Perps Market - DOGE_USDC', role: 'market'
	},
	'thor1wastjc07zuuy46mzzl3egz4uzy6fs59752grxqvz8zlsqccpv2wqjtw9mm': {
		category: 'Levana Perps', product: 'Levana Perps',
		name: 'Levana Perps Market - ETH_USDC', role: 'market'
	},
	'thor1zmgfjea6e4p94n07j6982yhmhhg5yev33u3v8vwdjkkaa0748ljqypzf9r': {
		category: 'Levana Perps', product: 'Levana Perps',
		name: 'Levana Perps Market - LTC_USDC', role: 'market'
	},
	'thor19egn9e8v5493mtum626upcjyu5xj3mru57htge0ma66sk5gyqf4qac33sr': {
		category: 'Levana Perps', product: 'Levana Perps',
		name: 'Levana Perps Market - RUNE_USDC', role: 'market'
	},
	'thor105espjya6qc7tazk8drsnvf2675q5wywafnwlhs5tpx9yza7hpmqpynjwv': {
		category: 'Levana Perps', product: 'Levana Perps',
		name: 'Levana Perps Market - XRP_USDC', role: 'market'
	},
	'thor1gclfrvam6a33yhpw3ut3arajyqs06esdvt9pfvluzwsslap9p6uqt4rzxs': {
		category: 'Levana Perps', product: 'Levana Perps',
		name: 'Levana Perps factory', role: 'factory'
	},
	'thor1v3f7h384r8hw6r3dtcgfq6d5fq842u6cjzeuu8nr0cp93j7zfxyquyrfl8': {
		category: 'RUJI Index', product: 'RUJI Index',
		name: 'RUJI Index affiliate', role: 'affiliate'
	},
	'thor1q9q732ell3urxvlcx24s8zrqr6g5s9ymnh9844auvqcp3qwpsjeqqpgxxz': {
		category: 'RUJI Index', product: 'RUJI Index',
		name: 'RUJI Index entry adapter', role: 'adapter'
	},
	'thor1yqf5spdv8c4088zmvqsg32eq63fzepsjvntahdk0ek0yjnkt3qdqftp3lc': {
		category: 'RUJI Index', product: 'RUJI Index',
		name: 'RJI - The Rujira Index', role: 'Fixed index'
	},
	'thor1mlphkryw5g54yfkrp6xpqzlpv4f8wh6hyw27yyg4z2els8a9gxpqhfhekt': {
		category: 'RUJI Index', product: 'RUJI Index',
		name: 'yRUNE - The Yield Bearing RUNE Index', role: 'NAV index'
	},
	'thor1h0hr0rm3dawkedh44hlrmgvya6plsryehcr46yda2vj0wfwgq5xqrs86px': {
		category: 'RUJI Index', product: 'RUJI Index',
		name: 'yTCY - The Yield Bearing TCY Index', role: 'NAV index'
	},
	'thor1s8rxcvg83cwar87ehv4c866auxujkfj3k4wjkxkaren7vmvn9nass80ekp': {
		category: 'RUJI Trade', product: 'RUJI Trade',
		name: 'RUJI Trade ATOM-USDC', role: 'Trading pair'
	},
	'thor15t4cykf3mj8fsvd6ha8j0lnavcyex2h4a4l2pv8zkctandwck3zshs92jy': {
		category: 'RUJI Trade', product: 'RUJI Trade',
		name: 'RUJI Trade AUTO-USDC', role: 'Trading pair'
	},
	'thor1dw8tadkwy746ytvaugv26g5jwekwpfyjyvlvncvryukm07rc998s4ukvrt': {
		category: 'RUJI Trade', product: 'RUJI Trade',
		name: 'RUJI Trade AVAX-USDC', role: 'Trading pair'
	},
	'thor1s4jpxtz0jsh6elyqcdujd303ptefz53gknmcp437rm9ykxnfhysqrm5hze': {
		category: 'RUJI Trade', product: 'RUJI Trade',
		name: 'RUJI Trade BCH-USDC', role: 'Trading pair'
	},
	'thor1g49m6re9vgrte8twpgx0qcnvr92575tqhcgmnwq3g5s94msk4ersqsyw3x': {
		category: 'RUJI Trade', product: 'RUJI Trade',
		name: 'RUJI Trade BNB-USDC', role: 'Trading pair'
	},
	'thor1vk6trmz42cjrh4zcxczeaacnsv3snv4f22x8ccu203dqde7vtaxsyevlec': {
		category: 'RUJI Trade', product: 'RUJI Trade',
		name: 'RUJI Trade bRUNE-RUNE', role: 'Trading pair'
	},
	'thor1dwsnlqw3lfhamc5dz3r57hlsppx3a2n2d7kppccxfdhfazjh06rs5077sz': {
		category: 'RUJI Trade', product: 'RUJI Trade',
		name: 'RUJI Trade BTC-USDC', role: 'Trading pair'
	},
	'thor1sttnfysg5e92d82gu9vg7jl9dhu29h4w8mujg7hsfdy3qj6ryuwsaqwu5m': {
		category: 'RUJI Trade', product: 'RUJI Trade',
		name: 'RUJI Trade BTC-USDT', role: 'Trading pair'
	},
	'thor1ar3grsxufvmr3fq8j92ssvc8vcyzdkhh9rlg5mdmuw8we552htxsf4mct2': {
		category: 'RUJI Trade', product: 'RUJI Trade',
		name: 'RUJI Trade cbBTC.BASE-BTC', role: 'Trading pair'
	},
	'thor1qa2l2rrzjq30j2wphc3hcz3ykjz8aaqcjlrnzmp00hy0cpk233ysm9rr3c': {
		category: 'RUJI Trade', product: 'RUJI Trade',
		name: 'RUJI Trade DAI-USDC', role: 'Trading pair'
	},
	'thor1w8agselh7k2e4ty369v39lngkckljxfafm35d06f7wj3ar90h2esv75t7p': {
		category: 'RUJI Trade', product: 'RUJI Trade',
		name: 'RUJI Trade DOGE-USDC', role: 'Trading pair'
	},
	'thor1624v08rr5na2hv5jazw5tmyyjyqg8lfy78zvck52ep3nqxa7lljq00e4xq': {
		category: 'RUJI Trade', product: 'RUJI Trade',
		name: 'RUJI Trade ETH.BASE-ETH', role: 'Trading pair'
	},
	'thor1g3mymxjlmvyeadfys6lsj98sgg7mxut5pwz99q5rat7ny698elwq778ngf': {
		category: 'RUJI Trade', product: 'RUJI Trade',
		name: 'RUJI Trade ETH-BTC', role: 'Trading pair'
	},
	'thor1tnd06uswj8033d0kzd5d7zre73u3uc44r2vvez26z5m4kr68vtusf2snva': {
		category: 'RUJI Trade', product: 'RUJI Trade',
		name: 'RUJI Trade ETH-USDC', role: 'Trading pair'
	},
	'thor1fekmqh9crnzdaudrsqxk5gmwcch6xrfre288nqmx4hpk8sscw6hq9kkxn6': {
		category: 'RUJI Trade', product: 'RUJI Trade',
		name: 'RUJI Trade ETH-USDT', role: 'Trading pair'
	},
	'thor19pdw7vjkhk0qhvn7r3xgj6f5zyyj700w6my3z28cv9ugzu7gp5rqv5596l': {
		category: 'RUJI Trade', product: 'RUJI Trade',
		name: 'RUJI Trade GUSD-USDC', role: 'Trading pair'
	},
	'thor1t76lvqjq7avt6kxnul4pt0zaq6y06fhkw29wxs5rm4kt873s6y9sdp8rxf': {
		category: 'RUJI Trade', product: 'RUJI Trade',
		name: 'RUJI Trade LQDY-BTC', role: 'Trading pair'
	},
	'thor1ax94w4rldvdgc4xgsfwgve7g7xfyxhvuvquvx57vtmr6y4alev0qw3mlvr': {
		category: 'RUJI Trade', product: 'RUJI Trade',
		name: 'RUJI Trade LQDY-USDC', role: 'Trading pair'
	},
	'thor1ks9qq0nwv7qxtnznesys6ylflwruqlf85er6zls4erwgzkvw0m0qs3rghz': {
		category: 'RUJI Trade', product: 'RUJI Trade',
		name: 'RUJI Trade LTC-USDC', role: 'Trading pair'
	},
	'thor1txmrchsrzycmzvlwsjl20q9zkdsp0nywctefuceepf02phpudvxsxtzmty': {
		category: 'RUJI Trade', product: 'RUJI Trade',
		name: 'RUJI Trade NAMI-USDC', role: 'Trading pair'
	},
	'thor1j9euq8fjd5zdxdkx7auser7kp84tmwtx3snuptpec6azakzwv3dqq6ahwp': {
		category: 'RUJI Trade', product: 'RUJI Trade',
		name: 'RUJI Trade RUJI-RUNE', role: 'Trading pair'
	},
	'thor17cawwg2lsnvcne69fek6nsqkf8snma6gc5ccceshul86rl0u3q4s5l5d0a': {
		category: 'RUJI Trade', product: 'RUJI Trade',
		name: 'RUJI Trade RUJI-USDC', role: 'Trading pair'
	},
	'thor1qqql3tugjuwnslfgf9a9zfqenywn2h8zy9v025vh3398xtzpaqcsx5axyl': {
		category: 'RUJI Trade', product: 'RUJI Trade',
		name: 'RUJI Trade RUNE-BTC', role: 'Trading pair'
	},
	'thor1y8g3yhzmnwyt6g7jque36eyregf85kgtzem6dgzqxuzrpmzpumvqts7ud7': {
		category: 'RUJI Trade', product: 'RUJI Trade',
		name: 'RUJI Trade RUNE-USDC', role: 'Trading pair'
	},
	'thor1jshw3secvxhzfyza6aj530hrc73zave42zgs525n0xkc3e9d6wkqrm8j3y': {
		category: 'RUJI Trade', product: 'RUJI Trade',
		name: 'RUJI Trade TCY-BTC', role: 'Trading pair'
	},
	'thor12ds7fxj5g47jwzfzvzzhzxxd3cp6v55flgwxva0803r8k5mzm44skth6wa': {
		category: 'RUJI Trade', product: 'RUJI Trade',
		name: 'RUJI Trade TCY-RUNE', role: 'Trading pair'
	},
	'thor1kyjky2yprmamj0gfkevyc6tunxev0054gpxjap8k9vkyutkkf5lqyr0xxv': {
		category: 'RUJI Trade', product: 'RUJI Trade',
		name: 'RUJI Trade TCY-USDC', role: 'Trading pair'
	},
	'thor14sk3vqzt6rpp8c06ynfhw30ctk0wy5mqhvedccg8gnnlcdcyc9csaf4ngt': {
		category: 'RUJI Trade', product: 'RUJI Trade',
		name: 'RUJI Trade USDC.AVAX-USDC', role: 'Trading pair'
	},
	'thor1kkuhwaqnlnvchx6fzttp7l9vhman9ll9u6dyhx65v4c7gcpflvcqkdv7z9': {
		category: 'RUJI Trade', product: 'RUJI Trade',
		name: 'RUJI Trade USDC.BASE-USDC', role: 'Trading pair'
	},
	'thor1f9zc2sdua4n6nreuxzhed9435n0cf6v6lpx6nrjdadtkr294a26qhs676n': {
		category: 'RUJI Trade', product: 'RUJI Trade',
		name: 'RUJI Trade USDC.BSC-USDC', role: 'Trading pair'
	},
	'thor1zj84djje5t0cn3veezmlfewmzmn6yn793nkrtfkjhcywdyyca9tq9582yf': {
		category: 'RUJI Trade', product: 'RUJI Trade',
		name: 'RUJI Trade USDP-USDC', role: 'Trading pair'
	},
	'thor1mj73004rhycffu6k56dalt0zmefzdc3ana6egkh4aes9aw43lxqqmfq2xg': {
		category: 'RUJI Trade', product: 'RUJI Trade',
		name: 'RUJI Trade USDT.AVAX-USDC', role: 'Trading pair'
	},
	'thor1mgjtf976cnurac63yh2tldmw2mme5f4a8n0u7m3d5yvxk6x5yrws4u37es': {
		category: 'RUJI Trade', product: 'RUJI Trade',
		name: 'RUJI Trade USDT.BSC-USDC', role: 'Trading pair'
	},
	'thor14qg8r6u7x4yt57565ztm6v8fwkd2t0j8wqnx6k872yt49ynx8d0q6s7kq0': {
		category: 'RUJI Trade', product: 'RUJI Trade',
		name: 'RUJI Trade USDT-USDC', role: 'Trading pair'
	},
	'thor1e5dmfdtpveprsznzyqjdygy2fd782d0q9zm7246e7jhvmq04nqnqm78vek': {
		category: 'RUJI Trade', product: 'RUJI Trade',
		name: 'RUJI Trade wBTC-BTC', role: 'Trading pair'
	},
	'thor14v89h32ztmfg9d230cjly7ac26fvdkhgq7nkntsw4uy2f3yh2v7qrz6hsw': {
		category: 'RUJI Trade', product: 'RUJI Trade',
		name: 'RUJI Trade XRP-USDC', role: 'Trading pair'
	},
	'thor1ekkt8wfls055t7f7yznj07j0s4mtndkq546swutzv2de7sfcxptq27duyt': {
		category: 'RUJI Money Market', product: 'RUJI Money Market',
		name: 'RUJI Credit Account', role: 'Credit'
	},
	'thor1wl05yf4keucptp9m69yzenafmn674r9jcwfwdufar75hq9hcmu9sk66g8w': {
		category: 'RUJI Money Market', product: 'RUJI Money Market',
		name: 'Lending vault: ATOM', role: 'Lending vault'
	},
	'thor13etu2zrdqlh69j87dd5dlnfpwa6cuhzlphm7jhj097uvue7mpc5s8y7xal': {
		category: 'RUJI Money Market', product: 'RUJI Money Market',
		name: 'Lending vault: AVAX', role: 'Lending vault'
	},
	'thor1km2sgadhmev34v40evf8qh2yw77hxecakn9nu0g35zdtsf905ehqhqk76r': {
		category: 'RUJI Money Market', product: 'RUJI Money Market',
		name: 'Lending vault: BCH', role: 'Lending vault'
	},
	'thor1r6c37cu0twdkgp9df3z0kkscdwakqmvvkfzvkf2kl0glr7klkzas9e4fld': {
		category: 'RUJI Money Market', product: 'RUJI Money Market',
		name: 'Lending vault: BNB', role: 'Lending vault'
	},
	'thor18e6gxcvmqfn06l09gurgwh3urlj9xztqagaslgspl2l74ejuujnqqlzzun': {
		category: 'RUJI Money Market', product: 'RUJI Money Market',
		name: 'Lending vault: BTC', role: 'Lending vault'
	},
	'thor1ycnr44val8v9rexn0qa06m920gr4rrrnldkcnf3pah5nr0lkdsxsnxnwsm': {
		category: 'RUJI Money Market', product: 'RUJI Money Market',
		name: 'Lending vault: cbBTC.BASE', role: 'Lending vault'
	},
	'thor1pkuuapnanzxseywxgp2dmd39p2ysgws2gq9dzs2kw680ed7x58rq03fs9a': {
		category: 'RUJI Money Market', product: 'RUJI Money Market',
		name: 'Lending vault: DAI', role: 'Lending vault'
	},
	'thor1drfu6vrn06gam7fdk07xqmavthgy6rnmnmm2mh4fa047qsny52aqvxuck9': {
		category: 'RUJI Money Market', product: 'RUJI Money Market',
		name: 'Lending vault: DOGE', role: 'Lending vault'
	},
	'thor1xufzny7n3565jy3rvglacengpn6eufw7lk5y9h4zxludkfe96q4s9j5uln': {
		category: 'RUJI Money Market', product: 'RUJI Money Market',
		name: 'Lending vault: ETH', role: 'Lending vault'
	},
	'thor1yskkyzurah4yxj49udkgacpfj0mkyfmm23al5rmng7nuktd3vpusv8r66h': {
		category: 'RUJI Money Market', product: 'RUJI Money Market',
		name: 'Lending vault: ETH.BASE', role: 'Lending vault'
	},
	'thor1u6razughlrjdu99ku3n803fq0pj5upnut2axj0kxpeaanch9kh7qfprdsn': {
		category: 'RUJI Money Market', product: 'RUJI Money Market',
		name: 'Lending vault: GUSD', role: 'Lending vault'
	},
	'thor1633kq6mxwn24ezdn38xpngksx8wlu458yesdqf3xhs2cfaan96cs2c3gdz': {
		category: 'RUJI Money Market', product: 'RUJI Money Market',
		name: 'Lending vault: LTC', role: 'Lending vault'
	},
	'thor12xadusl39ad4ru8j333pgylav2lqkgldf0l2etx6wv9u5npzm3as4l5nxx': {
		category: 'RUJI Money Market', product: 'RUJI Money Market',
		name: 'Lending vault: RUNE', role: 'Lending vault'
	},
	'thor19l9tl8h6nkf5ea4qaxqht6qzgrh5nnh3sng588plke7n72swhn4s5lpyru': {
		category: 'RUJI Money Market', product: 'RUJI Money Market',
		name: 'Lending vault: USDC.BASE', role: 'Lending vault'
	},
	'thor1jj7nt72ne7mvtsfvp9rze6w4d8pz69cr5s04602gestqpleamweqw8wm6y': {
		category: 'RUJI Money Market', product: 'RUJI Money Market',
		name: 'Lending vault: USDP', role: 'Lending vault'
	},
	'thor1smdzjdm5q5e5kf6farvcgmxe44uhga2ety68veu2nupf5dzx55xsn3u4rj': {
		category: 'RUJI Money Market', product: 'RUJI Money Market',
		name: 'Lending vault: USDT', role: 'Lending vault'
	},
	'thor1es23h3sdeytdhntaa88xl3fndj3vahpzm3d0xe8f2vf80d8kygwqlm7zux': {
		category: 'RUJI Money Market', product: 'RUJI Money Market',
		name: 'Lending vault: USDT.BSC', role: 'Lending vault'
	},
	'thor1374grrwf8fndz2glcas7vt6y0fa5vw4lxgh7ay9wm4kc5cjymygsatfs6k': {
		category: 'RUJI Money Market', product: 'RUJI Money Market',
		name: 'Lending vault: WBTC', role: 'Lending vault'
	},
	'thor1cvry7e7uzd89dv4hls5rg5m4xykczzu2qvj8dq5e93c75566tk9q7cya3l': {
		category: 'RUJI Money Market', product: 'RUJI Money Market',
		name: 'Lending vault: XRP', role: 'Lending vault'
	},
	'thor1mcy9jtp4kzl8q2lvdgfgsl8jvqrf504uphkf0pz2p9wud8tsntesjvccew': {
		category: 'Utilities', product: 'Revenue collector',
		name: 'Revenue Converter #1: Single', role: 'Revenue collector'
	},
	'thor1gm8q2gr25nzzsxzdp2mpja4hyvyhjlr4s6krcsgv2y953uu0js3qhwpus7': {
		category: 'Utilities', product: 'Revenue collector',
		name: 'Revenue Converter #2: RUJI Trade', role: 'Revenue collector'
	},
	'thor1jduxxzpyyvrgzx7zcnl7e5cdj34tnq5jxy00a4wp86szye25dndq575c0y': {
		category: 'Utilities', product: 'Revenue collector',
		name: 'Revenue Converter #3: Split', role: 'Revenue collector'
	},
	'thor1txum04wp8ykqudphxy9prtwsd9jpcm2kwdaxctxeeyr6g0r0we9qpfdktr': {
		category: 'Utilities', product: 'Revenue collector',
		name: 'Revenue Converter #4: Base Layer', role: 'Revenue collector'
	},
	'thor132u9qpm9gfdqtgwxwl8ty409s6zmewfrum2k6wvtvtyphdn5urzsej764l': {
		category: 'Utilities', product: 'Revenue collector',
		name: 'Revenue Converter #5: NAMI Index', role: 'Revenue collector'
	},
	'thor179fex2rxd45caedmz4hxsnu42sw20lu0djyh4yukyh965sq8muuqptru2g': {
		category: 'Utilities', product: 'Staking',
		name: 'bRUNE Staking', role: 'Staking'
	},
	'thor18kxeqhw8nukm3sksj56uh4zf76ctn0mm3x8yrzr56hdhlsk966dqqeedwx': {
		category: 'Utilities', product: 'Staking',
		name: 'NAMI Staking', role: 'Staking'
	},
	'thor13g83nn5ef4qzqeafp0508dnvkvm0zqr3sj7eefcn5umu65gqluusrml5cr': {
		category: 'Utilities', product: 'Staking',
		name: 'RUJI Staking', role: 'Staking'
	},
	'thor1z7ejlk5wk2pxh9nfwjzkkdnrq4p2f5rjcpudltv0gh282dwfz6nq9g2cr0': {
		category: 'Utilities', product: 'Staking',
		name: 'TCY autocompounder (AutoRujira)', role: 'Staking'
	},
	'thor1n5a08r0zvmqca39ka2tgwlkjy9ugalutk7fjpzptfppqcccnat2ska5t4g': {
		category: 'AMM strategy', product: 'Virtualisation Strategy',
		name: 'Virtualisation Strategy', role: 'AMM strategy'
	},
	'thor1f88gayqapexm5ywmdn85c2s62h84j7gjhg8582ctxyew42n308pqqyg7js': {
		category: 'AMM strategy', product: 'XYK Pool',
		name: 'XYK Pool: ETH/USDC', role: 'AMM strategy'
	},
	'thor1g97844v7wuvz58m6p3vqp3u28nxaglqsag4dte2wrrry7sge9llq0t5tav': {
		category: 'AMM strategy', product: 'XYK Pool',
		name: 'XYK Pool: BTC/USDC', role: 'AMM strategy'
	},
	'thor1z6drgxf8js4mycfqfgqr3v4paep4p5ur7ff0suehyg0a6alm8uks29zyv0': {
		category: 'AMM strategy', product: 'XYK Pool',
		name: 'XYK Pool: RUJI/USDC', role: 'AMM strategy'
	},
	'thor1nwpkxz6ww2q6dz8ulkt804z8azm57s8lrrn67usrhpqxjt6sakeq24rf09': {
		category: 'AMM strategy', product: 'XYK Pool',
		name: 'XYK Pool: ETH/BTC', role: 'AMM strategy'
	},
	'thor185dc632j6nv0apdcg5lq7uppast0nmd4awkgzcfcq7phx65w3mjq0mmwqh': {
		category: 'AMM strategy', product: 'XYK Pool',
		name: 'XYK Pool: AUTO/USDC', role: 'AMM strategy'
	},
	'thor1c020ygq35hu6fp2hpd3ws0fa9xmlqhpw9g4nz624wnwmvlq7l49s877kkx': {
		category: 'AMM strategy', product: 'XYK Pool',
		name: 'XYK Pool: LQDY/USDC', role: 'AMM strategy'
	},
	'thor1lpupl5c5yfa2shd0uk3t0clahsv237zz8a7nvrdrktrjrxwgz56s80kew4': {
		category: 'AMM strategy', product: 'XYK Pool',
		name: 'XYK Pool: LQDY/BTC', role: 'AMM strategy'
	},
	'thor122f5ezcpnucazcjslwy4gg4q663lrn8xd0sum75ggv83v77tegpqclzq0v': {
		category: 'AMM strategy', product: 'XYK Pool',
		name: 'XYK Pool: BNB/USDC', role: 'AMM strategy'
	},
	'thor1qk2g3e6pg0rcsa0w9079zvczlldjufulp5an8gs5qdqym297jv5qxm73rr': {
		category: 'AMM strategy', product: 'XYK Pool',
		name: 'XYK Pool: BCH/USDC', role: 'AMM strategy'
	},
	'thor1s5g0rm6fk2cpcxmsy3zgft725azrxsmuxxrjzrgxzfe298g2m7uqt2ejw6': {
		category: 'AMM strategy', product: 'XYK Pool',
		name: 'XYK Pool: DOGE/USDC', role: 'AMM strategy'
	},
	'thor1rw9awvqnl6n0slk6tl9pw6nan77kum5480r93stc6unzlaneh6wqzrw0za': {
		category: 'AMM strategy', product: 'XYK Pool',
		name: 'XYK Pool: LTC/USDC', role: 'AMM strategy'
	},
	'thor19e8l7xkkkce0k5cjcz65ae9ntvjqft9cxcq2qn0tdtsc7339lv2szdqfhh': {
		category: 'AMM strategy', product: 'XYK Pool',
		name: 'XYK Pool: ATOM/USDC', role: 'AMM strategy'
	},
	'thor1vjxfh0smv78zchf0jcdz2wfv80nuhe2lcfr3dewde9p6khh4g7hq6sgtjw': {
		category: 'AMM strategy', product: 'XYK Pool',
		name: 'XYK Pool: AVAX/USDC', role: 'AMM strategy'
	},
	'thor193ec9vn36q9752ut6ntqpt94yfdcwxt4u47fmsv9ql4n7fkac38qucqckc': {
		category: 'AMM strategy', product: 'XYK Pool',
		name: 'XYK Pool: XRP/USDC', role: 'AMM strategy'
	},
	'thor1j45s6a4ym8ru2zd70acnrwk4fkmew2a43eq2wngu46ur7yg4d8eqnvvfxx': {
		category: 'AMM strategy', product: 'XYK Pool',
		name: 'XYK Pool: NAMI/USDC', role: 'AMM strategy'
	},
};

/** Look up a contract label for a thor address. Returns the Name or undefined. */
export function getContractLabel(address: string): string | undefined {
	return RUJIRA_CONTRACTS[address]?.name;
}

/** Look up the full contract entry for a thor address. */
export function getContract(address: string): RujiraContract | undefined {
	return RUJIRA_CONTRACTS[address];
}

/** Check if a thor address is a known Rujira contract. */
export function isContract(address: string): boolean {
	return address in RUJIRA_CONTRACTS;
}
