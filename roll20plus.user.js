// ==UserScript==
// @name         Roll20-Plus
// @namespace    https://github.com/kcaf
// @license      MIT (https://opensource.org/licenses/MIT)
// @version      2.6.7
// @updateURL    https://github.com/kcaf/Roll20-Plus/raw/master/roll20plus.user.js
// @downloadURL  https://github.com/kcaf/Roll20-Plus/raw/master/roll20plus.user.js
// @description  Roll20 Plus
// @author       kcaf
// @match        https://app.roll20.net/editor/
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

var Roll20Plus = function(version) {
	var d20plus = {
		sheet: "ogl",
		version: version,
		scriptsLoaded: false
	};

	// Window loaded
	window.onload = function() {
		window.unwatch("d20");

		var checkLoaded = setInterval(function() {
			if (!$("#loading-overlay").is(":visible")) {
				clearInterval(checkLoaded);
				d20plus.Init();
			}
		}, 1000);
	};

	// Page fully loaded and visible
	d20plus.Init = function() {
		d20plus.log("> Init (v" + d20plus.version + ")");

		// Firebase will deny changes if we're not GM. Better to fail gracefully.
		if (window.is_gm) {
			d20plus.log("> Is GM");
		} else {
			d20plus.log("> Not GM. Exiting.");
			return;
		}

		d20plus.log("> Add JS");
		d20plus.addScripts();

		d20plus.log("> Add CSS");
		_.each(d20plus.cssRules, function(r) {
			d20plus.addCSS(window.document.styleSheets[window.document.styleSheets.length-1], r.s, r.r);
		});

		d20plus.log("> Add HTML");
		d20plus.addHTML();

		d20plus.log("> Initiative Tracker");
		$("#initiativewindow .characterlist").before(d20plus.initiativeHeaders);
		$("#tmpl_initiativecharacter").replaceWith(d20plus.getInitTemplate());
		d20.Campaign.initiativewindow._rebuildInitiativeList();
		d20plus.hpAllowEdit();

		d20plus.log("> Bind Events");
		d20.Campaign.activePage().thegraphics.on("add", function(e) {
			var character = e.character;
			if(character) {
				var	npc = character.attribs.find(function(a){return a.get("name").toLowerCase() == "npc"; }),
					isNPC = npc ? parseInt(npc.get("current")) : 0;
				if(isNPC) {
					var hpf = character.attribs.find(function(a){return a.get("name").toLowerCase() == "npc_hpformula"; });
					if(hpf) {
						var hpformula = hpf.get("current");
						if(hpformula) {
							d20plus.randomRoll(hpformula, function(result) {
								e.attributes.bar3_value = result.total;
								e.attributes.bar3_max = result.total;
								d20plus.log("> Rolled HP for [" + character.get("name") + "]");
							}, function(error) {
								d20plus.log("> Error Rolling HP Dice");
								console.log(error);
							});
						}
					}
				}
			}
		});
	};

	// Does a monster already exist with this name
	d20plus.monsterExists = function(folderObj, folderId, name) {
		var container = folderObj.find(function(a){return a.id == folderId});
			result = false;
		$.each(container.i, function(i,v) {
			var char = d20.Campaign.characters._byId[v];
			if(char && char.get("name") == name){
				result = true;
			}
		});
		return result;
	};

	// Insert HTML
	d20plus.addHTML = function() {
		$("body").append($(d20plus.statHtml));
		$("#mysettings > .content").children("hr").first().before(d20plus.settingsHtml);
		$("#mysettings > .content select#d20plus-sheet").on("change", d20plus.setSheet);
		$("#mysettings > .content a#d20plus-btn-im").on("click", d20plus.buttonMonsterClicked);
	};

	// Run external scripts
	d20plus.addScripts = function() {
		$.each(d20plus.scripts, function(i,v) {
			$.ajax({
				type: "GET",
				url: v.url,
				success: function (js) {
					try {
						window.eval(js);
						d20plus.log("> JS [" + v.name + "] Loaded");
					} catch (e) {
						d20plus.log("> Error loading " + v.name);
					}
				}
			});
		});
	};

	// Import monsters button click event
	d20plus.buttonMonsterClicked = function() {
		var url = window.prompt("Input the URL of the Monster XML file");
		if (url != null) {
			d20plus.loadMonstersXML(url);
		}
	};

	// Fetch monster data from XML url
	d20plus.loadMonstersXML = function(url) {
		$("a.ui-tabs-anchor[href='#journal']").trigger("click");
		var x2js = new X2JS();
		$.ajax({
			type: "GET",
			url: url,
			dataType: "xml",
			success: function (xml) {
				json = x2js.xml2json(xml);
				var time = 500;
				$.each(json.compendium.monster, function(i,v) {
					setTimeout(function() {
						try {
							d20plus.log("> " + (i+1) + " Attempting to import monster [" + v.name + "]");
							d20plus.importMonster(v);
						} catch (e) {
							d20plus.log("I have failed you :(");
							console.log(data);
							console.log(e);
						}
					}, time);
					time += 2000;
				});
			}
		});
	};

	// Create monster character from data
	d20plus.importMonster = function (data) {
		var fname = "Monsters",
			findex = 1;

		d20.journal.refreshJournalList();
		var journalFolder = d20.Campaign.get("journalfolder");
		if(journalFolder === ""){
			d20.journal.addFolderToFolderStructure("Characters");
			d20.journal.refreshJournalList();
			journalFolder = d20.Campaign.get("journalfolder");
		}
		var journalFolderObj = JSON.parse(journalFolder);

		// clean this up later
		for(i=0; i<99; i++) {
			var theFolderName = fname + " " + findex;
			folder = journalFolderObj.find( function (f) {return f.n == theFolderName;} );
			if(folder) {
				if(folder.i.length >= 90) {
					findex++;
				} else {
					i = 100;
				}
			} else {
				d20.journal.addFolderToFolderStructure(theFolderName);
				folder = journalFolderObj.find( function (f) {return f.n == theFolderName;} );
				i = 100;
			}
		}
		
		if(!folder) return;

		var name = data.name || "(Unknown Name)",
			mFolders = journalFolderObj.filter(function(a){return a.n.indexOf("Monsters ") !== -1}),
			dupe = false;

		$.each(mFolders, function(i,v) {
			if(d20plus.monsterExists(journalFolderObj, v.id, name))
				dupe = true;
		});
		if (dupe) {
			console.log("Already Exists");
			return;
		}

		d20.Campaign.characters.create({
			name: name
		}, {
			success: function(character) {
				/* OGL Sheet */
				try {
					var ac = data.ac.match(/^\d+/),
						actype = /\(([^)]+)\)/.exec(data.ac),
						hp = data.hp.match(/^\d+/),
						hpformula = /\(([^)]+)\)/.exec(data.hp),
						passive = data.passive != null ? data.passive : "",
						passiveStr = passive !== "" ? "passive Perception " + passive : "",
						senses = data.senses || "",
						sensesStr = senses !== "" ? senses + ", " + passiveStr : passiveStr,
						size = d20plus.getSizeString(data.size || ""),
						type = data.type || "(Unknown Type)",
						alignment = data.alignment || "(Unknown Alignment)",
						cr = data.cr != null ? data.cr : "",
						xp = d20plus.getXP(cr);

					character.attribs.create({ name: "npc", current: 1 });
					character.attribs.create({ name: "npc_toggle", current: 1 });
					character.attribs.create({ name: "npc_options-flag", current: 0 });
					character.attribs.create({ name: "wtype", current: "/w gm" });
					character.attribs.create({ name: "rtype", current: "{{always=1}} {{r2=[[1d20" });
					character.attribs.create({ name: "dtype", current: "full" });
					character.attribs.create({ name: "npc_name", current: name });
					character.attribs.create({ name: "npc_size", current: size });
					character.attribs.create({ name: "type", current: type });
					character.attribs.create({ name: "npc_type", current: size + " " + type + ", " + alignment });
					character.attribs.create({ name: "npc_alignment", current: alignment });
					character.attribs.create({ name: "npc_ac", current: ac != null ? ac[0] : "" });
					character.attribs.create({ name: "npc_actype", current: actype != null ? actype[1] || "" : "" });
					character.attribs.create({ name: "npc_hpbase", current: hp != null ? hp[0] : "" });
					character.attribs.create({ name: "npc_hpformula", current: hpformula != null ? hpformula[1] || "" : "" });
					character.attribs.create({ name: "npc_speed", current: data.speed != null ? data.speed : "" });
					character.attribs.create({ name: "strength", current: data.str });
					character.attribs.create({ name: "dexterity", current: data.dex });
					character.attribs.create({ name: "constitution", current: data.con });
					character.attribs.create({ name: "intelligence", current: data.int });
					character.attribs.create({ name: "wisdom", current: data.wis });
					character.attribs.create({ name: "charisma", current: data.cha });
					character.attribs.create({ name: "passive", current: passive });
					character.attribs.create({ name: "npc_languages", current: data.languages != null ? data.languages : "" });
					character.attribs.create({ name: "npc_challenge", current: cr });
					character.attribs.create({ name: "npc_xp", current: xp });
					character.attribs.create({ name: "npc_vulnerabilities", current: data.vulnerable != null ? data.vulnerable : "" });
					character.attribs.create({ name: "npc_resistances", current: data.resist != null ? data.resist : "" });
					character.attribs.create({ name: "npc_immunities", current: data.immune != null ? data.immune : "" });
					character.attribs.create({ name: "npc_condition_immunities", current: data.conditionImmune != null ? data.conditionImmune : "" });
					character.attribs.create({ name: "npc_senses", current: sensesStr });

					//character.attribs.create({ name: "npc_skills", current: data.skill != null ? data.skill : "" });
					if(data.save != null && data.save.length > 0) {
						character.attribs.create({ name: "npc_saving_flag", current: 1 });
						var savingthrows = data.save.split(", ");
						$.each(savingthrows, function (i,v) {
							var save = v.split(" ");
							//console.log({ name: "npc_" + save[0].toLowerCase() + "_save", current: parseInt(save[1]) });
							character.attribs.create({ name: "npc_" + save[0].toLowerCase() + "_save", current: parseInt(save[1]) });
						});
					}

					if(data.skill != null && data.skill.length > 0) {
						character.attribs.create({ name: "npc_skills_flag", current: 1 });
						var skills = data.skill.split(", ");
						$.each(skills, function (i,v) {
							if(v.length > 0) {
								var skill = v.match(/([\w+ ]*[^+-?\d])([+-?\d]+)/);
								//console.log({ name: "npc_" + skill[0].toLowerCase(), current: parseInt(skill[1]) });
								character.attribs.create({ name: "npc_" + $.trim(skill[1]).toLowerCase(), current: parseInt($.trim(skill[2])) || 0 });
							}
						});
					}

					if(data.trait != null) {
						if(!(data.trait instanceof Array)) {
							var tmp = data.trait;
							data.trait = [];
							data.trait.push(tmp);
						}
						$.each(data.trait, function(i,v) {
							var newRowId = d20plus.generateRowId(),
								text = "";
							//console.log('trait',v);
							//console.log({ name: "repeating_npctrait_" + newRowId + "_name", current: v.name });
							character.attribs.create({ name: "repeating_npctrait_" + newRowId + "_name", current: v.name });
							if(v.text instanceof Array) {
								$.each(v.text, function(z,x) {
									text += (z > 0 ? "\r\n" : "") + x;
								});
							} else {
								text = v.text;
							}
							//console.log({ name: "repeating_npctrait_" + newRowId + "_desc", current: text });
							character.attribs.create({ name: "repeating_npctrait_" + newRowId + "_desc", current: text });
						});
					}

					if(data.action != null) {
						if(!(data.action instanceof Array)) {
							var tmp = data.action;
							data.action = [];
							data.action.push(tmp);
						}
						$.each(data.action, function(i,v) {
							var newRowId = d20plus.generateRowId(),
								actiontext = "",
								text = "";

							var rollbase = "@{wtype}&{template:npcaction} @{attack_display_flag} @{damage_flag} {{name=@{npc_name}}} {{rname=@{name}}} {{r1=[[1d20+(@{attack_tohit}+0)]]}} @{rtype}+(@{attack_tohit}+0)]]}} {{dmg1=[[@{attack_damage}+0]]}} {{dmg1type=@{attack_damagetype}}} {{dmg2=[[@{attack_damage2}+0]]}} {{dmg2type=@{attack_damagetype2}}} {{crit1=[[@{attack_crit}+0]]}} {{crit2=[[@{attack_crit2}+0]]}} {{description=@{description}}} @{charname_output}";
							if(v.attack != null) {
								if(!(v.attack instanceof Array)) {
									var tmp = v.attack;
									v.attack = [];
									v.attack.push(tmp);
								}
								$.each(v.attack, function(z,x) {
									var attack = x.split("|"),
										name = "";
									if(v.attack.length > 1)
										name = (attack[0] == v.name) ? v.name : v.name + " - " + attack[0] + "";
									else 
										name = v.name;
									
									var onhit = "",
										damagetype = "",
										damage = "" + attack[2],
										tohit = attack[1] || 0;
										
									character.attribs.create({ name: "repeating_npcaction_" + newRowId + "_name", current: name });
									character.attribs.create({ name: "repeating_npcaction_" + newRowId + "_attack_flag", current: "on" });
									character.attribs.create({ name: "repeating_npcaction_" + newRowId + "_npc_options-flag", current: 0 });
									character.attribs.create({ name: "repeating_npcaction_" + newRowId + "_attack_display_flag", current: "{{attack=1}}" });
									character.attribs.create({ name: "repeating_npcaction_" + newRowId + "_attack_options", current: "{{attack=1}}" });
									character.attribs.create({ name: "repeating_npcaction_" + newRowId + "_attack_tohit", current: tohit });
									character.attribs.create({ name: "repeating_npcaction_" + newRowId + "_attack_damage", current: damage });
									character.attribs.create({ name: "repeating_npcaction_" + newRowId + "_name_display", current: name });
									character.attribs.create({ name: "repeating_npcaction_" + newRowId + "_rollbase", current: rollbase });
									character.attribs.create({ name: "repeating_npcaction_" + newRowId + "_attack_type", current: "" });
									character.attribs.create({ name: "repeating_npcaction_" + newRowId + "_attack_tohitrange", current: "" });
									character.attribs.create({ name: "repeating_npcaction_" + newRowId + "_damage_flag", current: "{{damage=1}} {{dmg1flag=1}}" });
									if(damage !== "") {
										damage1 = damage.replace(/\s/g, '').split(/d|(?=\+|\-)/g);
										damage2 = isNaN(eval(damage1[1])) === false ? eval(damage1[1]) : 0;
										if(damage1.length < 2) {
											onhit = onhit + damage1[0] + " (" + damage + ")" + damagetype + " damage";
										}
										else if(damage1.length < 3) {
											onhit = onhit + Math.floor(damage1[0]*((damage2/2)+0.5)) + " (" + damage + ")" + damagetype + " damage";
										}
										else {
											onhit = onhit + (Math.floor(damage1[0]*((damage2/2)+0.5))+parseInt(damage1[2],10)) + " (" + damage + ")" + damagetype + " damage";
										};
									};
									character.attribs.create({ name: "repeating_npcaction_" + newRowId + "_attack_onhit", current: onhit });
								});
							} else {
								character.attribs.create({ name: "repeating_npcaction_" + newRowId + "_name", current: v.name });
								character.attribs.create({ name: "repeating_npcaction_" + newRowId + "_npc_options-flag", current: 0 });
								character.attribs.create({ name: "repeating_npcaction_" + newRowId + "_rollbase", current: rollbase });
								character.attribs.create({ name: "repeating_npcaction_" + newRowId + "_name_display", current: v.name });
							}


							if(v.text instanceof Array) {
								$.each(v.text, function(z,x) {
									text += (z > 0 ? "\r\n" : "") + x;
								});
							} else {
								text = v.text;
							}

							var descriptionFlag = Math.max(Math.ceil(text.length/57),1);
							character.attribs.create({ name: "repeating_npcaction_" + newRowId + "_description", current: text });
							character.attribs.create({ name: "repeating_npcaction_" + newRowId + "_description_flag", current: descriptionFlag });
						});
					}

					if(data.reaction != null) {
						if(!(data.reaction instanceof Array)) {
							var tmp = data.reaction;
							data.reaction = [];
							data.reaction.push(tmp);
						}
						character.attribs.create({ name: "reaction_flag", current: 1 });
						character.attribs.create({ name: "npcreactionsflag", current: 1 });
						$.each(data.reaction, function(i,v) {
							var newRowId = d20plus.generateRowId(),
								text = "";
							character.attribs.create({ name: "repeating_npcreaction_" + newRowId + "_name", current: v.name });
							if(v.text instanceof Array) {
								$.each(v.text, function(z,x) {
									text += (z > 0 ? "\r\n" : "") + x;
								});
							} else {
								text = v.text;
							}
							character.attribs.create({ name: "repeating_npcreaction_" + newRowId + "_desc", current: text });
						});
					}

					if(data.legendary != null) {
						if(!(data.legendary instanceof Array)) {
							var tmp = data.legendary;
							data.legendary = [];
							data.legendary.push(tmp);
						}
						character.attribs.create({ name: "legendary_flag", current: "1" });
						character.attribs.create({ name: "npc_legendary_actions", current: "(Unknown Number)" });
						$.each(data.legendary, function(i,v) {
							var newRowId = d20plus.generateRowId(),
								actiontext = "",
								text = "";
							
							var rollbase = "@{wtype}&{template:npcaction} @{attack_display_flag} @{damage_flag} {{name=@{npc_name}}} {{rname=@{name}}} {{r1=[[1d20+(@{attack_tohit}+0)]]}} @{rtype}+(@{attack_tohit}+0)]]}} {{dmg1=[[@{attack_damage}+0]]}} {{dmg1type=@{attack_damagetype}}} {{dmg2=[[@{attack_damage2}+0]]}} {{dmg2type=@{attack_damagetype2}}} {{crit1=[[@{attack_crit}+0]]}} {{crit2=[[@{attack_crit2}+0]]}} {{description=@{description}}} @{charname_output}";
							if(v.attack != null) {
								if(!(v.attack instanceof Array)) {
									var tmp = v.attack;
									v.attack = [];
									v.attack.push(tmp);
								}
								$.each(v.attack, function(z,x) {
									var attack = x.split("|"),
										name = "";
									if(v.attack.length > 1)
										name = (attack[0] == v.name) ? v.name : v.name + " - " + attack[0] + "";
									else 
										name = v.name;
									
									var onhit = "",
										damagetype = "",
										damage = "" + attack[2],
										tohit = attack[1] || 0;
										
									character.attribs.create({ name: "repeating_npcaction-l_" + newRowId + "_name", current: name });
									character.attribs.create({ name: "repeating_npcaction-l_" + newRowId + "_attack_flag", current: "on" });
									character.attribs.create({ name: "repeating_npcaction-l_" + newRowId + "_npc_options-flag", current: 0 });
									character.attribs.create({ name: "repeating_npcaction-l_" + newRowId + "_attack_display_flag", current: "{{attack=1}}" });
									character.attribs.create({ name: "repeating_npcaction-l_" + newRowId + "_attack_options", current: "{{attack=1}}" });
									character.attribs.create({ name: "repeating_npcaction-l_" + newRowId + "_attack_tohit", current: tohit });
									character.attribs.create({ name: "repeating_npcaction-l_" + newRowId + "_attack_damage", current: damage });
									character.attribs.create({ name: "repeating_npcaction-l_" + newRowId + "_name_display", current: name });
									character.attribs.create({ name: "repeating_npcaction-l_" + newRowId + "_rollbase", current: rollbase });
									character.attribs.create({ name: "repeating_npcaction-l_" + newRowId + "_attack_type", current: "" });
									character.attribs.create({ name: "repeating_npcaction-l_" + newRowId + "_attack_tohitrange", current: "" });
									character.attribs.create({ name: "repeating_npcaction-l_" + newRowId + "_damage_flag", current: "{{damage=1}} {{dmg1flag=1}}" });
									if(damage !== "") {
										damage1 = damage.replace(/\s/g, '').split(/d|(?=\+|\-)/g);
										damage2 = isNaN(eval(damage1[1])) === false ? eval(damage1[1]) : 0;
										if(damage1.length < 2) {
											onhit = onhit + damage1[0] + " (" + damage + ")" + damagetype + " damage";
										}
										else if(damage1.length < 3) {
											onhit = onhit + Math.floor(damage1[0]*((damage2/2)+0.5)) + " (" + damage + ")" + damagetype + " damage";
										}
										else {
											onhit = onhit + (Math.floor(damage1[0]*((damage2/2)+0.5))+parseInt(damage1[2],10)) + " (" + damage + ")" + damagetype + " damage";
										};
									};
									character.attribs.create({ name: "repeating_npcaction-l_" + newRowId + "_attack_onhit", current: onhit });
								});
							} else {
								character.attribs.create({ name: "repeating_npcaction-l_" + newRowId + "_name", current: v.name });
								character.attribs.create({ name: "repeating_npcaction-l_" + newRowId + "_npc_options-flag", current: 0 });
								character.attribs.create({ name: "repeating_npcaction-l_" + newRowId + "_rollbase", current: rollbase });
								character.attribs.create({ name: "repeating_npcaction-l_" + newRowId + "_name_display", current: v.name });
							}


							if(v.text instanceof Array) {
								$.each(v.text, function(z,x) {
									text += (z > 0 ? "\r\n" : "") + x;
								});
							} else {
								text = v.text;
							}

							var descriptionFlag = Math.max(Math.ceil(text.length/57),1);
							character.attribs.create({ name: "repeating_npcaction-l_" + newRowId + "_description", current: text });
							character.attribs.create({ name: "repeating_npcaction-l_" + newRowId + "_description_flag", current: descriptionFlag });
						});
					}

					character.view._updateSheetValues();
					var dirty = [];
					$.each(d20.journal.customSheets.attrDeps, function(i,v){ dirty.push(i) } );
					d20.journal.notifyWorkersOfAttrChanges(character.view.model.id, dirty, true);

				} catch (e) {
					d20plus.log("> Error loading [" + name + "]");
					console.log(data);
					console.log(e);
				}
				/* end OGL Sheet */

				//character.updateBlobs({gmnotes: gmnotes});
				d20.journal.addItemToFolderStructure(character.id, folder.id);
			}
		});
	};

	d20plus.getXP = function(cr) {
		var xp = "";
		switch(cr) {
			case "0":
				xp = "10";
				break;
			case "1/8":
				xp = "25";
				break;
			case "1/4":
				xp = "50";
				break;
			case "1/2":
				xp = "100";
				break;
			case "1":
				xp = "200";
				break;
			case "2":
				xp = "450";
				break;
			case "3":
				xp = "700";
				break;
			case "4":
				xp = "1100";
				break;
			case "5":
				xp = "1800";
				break;
			case "6":
				xp = "2300";
				break;
			case "7":
				xp = "2900";
				break;
			case "8":
				xp = "3900";
				break;
			case "9":
				xp = "5000";
				break;
			case "10":
				xp = "5900";
				break;
			case "11":
				xp = "7200";
				break;
			case "12":
				xp = "8400";
				break;
			case "13":
				xp = "10000";
				break;
			case "14":
				xp = "11500";
				break;
			case "15":
				xp = "13000";
				break;
			case "16":
				xp = "15000";
				break;
			case "17":
				xp = "18000";
				break;
			case "18":
				xp = "20000";
				break;
			case "19":
				xp = "22000";
				break;
			case "20":
				xp = "25000";
				break;
			case "21":
				xp = "33000";
				break;
			case "22":
				xp = "41000";
				break;
			case "23":
				xp = "50000";
				break;
			case "24":
				xp = "62000";
				break;
			case "25":
				xp = "75000";
				break;
			case "26":
				xp = "90000";
				break;
			case "27":
				xp = "105000";
				break;
			case "28":
				xp = "120000";
				break;
			case "29":
				xp = "135000";
				break;
			case "30":
				xp = "155000";
				break;
		}
		return xp;
	};

	// Get NPC size from chr
	d20plus.getSizeString = function(chr) {
		switch(chr){
			case "F":
				return "Fine";
			case "D":
				return "Diminutive";
			case "T":
				return "Tiny";
			case "S":
				return "Small";
			case "M":
				return "Medium";
			case "L":
				return "Large";
			case "H":
				return "Huge";
			case "G":
				return "Gargantuan";
			case "C":
				return "Colossal";
			default:
				return "(Unknown Size)";
		}
	};

	// Create ID for repeating row
	d20plus.generateRowId = function() {
		return window.generateUUID().replace(/_/g, "Z");
	};

	// Create editable HP variable and autocalculate + or -
	d20plus.hpAllowEdit = function() {
		$("#initiativewindow").on("click", ".hp.editable", function() {
			if ($(this).find("input").length > 0)
				return void $(this).find("input").focus();
			var val = $.trim($(this).text());
			$(this).html("<input type='text' value='" + val + "'/>");
			$(this).find("input").focus();
		});
		$("#initiativewindow").on("keydown", ".hp.editable", function(event) {
			if (event.which == 13) {
				var total = 0, $el, token, id, char, hp,
					val = $.trim($(this).find("input").val()),
					matches = val.match(/[+\-]*(\.\d+|\d+(\.\d+)?)/g) || [];
				while (matches.length) {
					total+= parseFloat(matches.shift());
				}
				$el = $(this).parents("li.token");
				id = $el.data("tokenid");
				token = d20.Campaign.pages.get(d20.Campaign.activePage()).thegraphics.get(id);
				char = token.character;
				npc = char.attribs.find( function (a) {return a.get("name").toLowerCase() === "npc";} );
				if (npc && npc.get("current") == "1") {
					token.attributes.bar3_value = total;
				} else {
					hp = char.attribs.find( function (a) {return a.get("name").toLowerCase() === "hp";} );
					if (hp) {
						hp.syncedSave({
							current: total
						});
					} else {
						char.attribs.create({
							name: "hp",
							current: total
						});
					}
				}
				d20.Campaign.initiativewindow._rebuildInitiativeList();
			}
		});
	};

	// Cross-browser add CSS rule
	d20plus.addCSS = function (sheet, selector, rules) {
		index = sheet.cssRules.length;
		if ("insertRule" in sheet) {
			sheet.insertRule(selector + "{" + rules + "}", index);
		}
		else if ("addRule" in sheet) {
			sheet.addRule(selector, rules, index);
		}
	};

	// Send string to chat using current char id
	d20plus.chatSend = function (str) {
		d20.textchat.doChatInput(str);
	};

	// Get character by name
	d20plus.charByName = function (name) {
		var char = null;
		d20.Campaign.characters.each(function(c) {
			if (c.get("name") == name) char = c;
		});
		return char;
	};

	// Prettier log
	d20plus.log = function (arg) {
		console.log("%cRoll20 Plus", "color: #3076b9; font-size: xx-large", arg);
	};

	// Return random result from rolling dice
	d20plus.randomRoll = function (roll, success, error) {
		d20.textchat.diceengine.process(roll, success, error );
	};

	// Return random integer between [0,int)
	d20plus.randomInt = function (int) {
		return d20.textchat.diceengine.random(int);
	};

	// Change character sheet formulas
	d20plus.setSheet = function () {
		var r = /^[a-z]+$/,
			s = $(this).val().match(r)[0];
		d20plus.sheet = s in d20plus.formulas ? s : "ogl";
		$("#tmpl_initiativecharacter").replaceWith(d20plus.getInitTemplate());
		d20.Campaign.initiativewindow._rebuildInitiativeList();
		d20plus.log("> Switched Character Sheet Template");
	};

	// Return Initiative Tracker template with formulas
	d20plus.getInitTemplate = function() {
		var html = d20plus.initiativeTemplate;
		_.each(d20plus.formulas[d20plus.sheet], function(v,i) {
			html = html.replace("||"+i+"||", v);
		});
		return html;
	};

	/*  */
	d20plus.formulas = {
		ogl: {
			"CR": "@{npc_challenge}",
			"AC": "@{ac}",
			"HP": "@{hp}",
			"PP": "@{passive_wisdom}"
		},
		community: {
			"CR": "@{npc_challenge}",
			"AC": "@{AC}",
			"HP": "@{HP}",
			"PP": "10 + @{perception}"
		}
	};

	d20plus.scripts = [
		{
			name: "xml2json",
			url: "https://cdnjs.cloudflare.com/ajax/libs/x2js/1.2.0/xml2json.min.js"
		}
	];

	d20plus.statHtml = `<script id="tmpl_statblock" type="text/html">
	<![CDATA[
	<div class="stat-block wide">
		<hr class="orange-border" />
		<div class="section-left">
			<div class="creature-heading">
				<h1><$!this.name$></h1>
				<h2><$!this.size$> <$!this.type$>, <$!this.alignment$></h2>
			</div> <!-- creature heading -->
			<svg height="5" width="100%" class="tapered-rule">
			<polyline points="0,0 400,2.5 0,5"></polyline>
		  </svg>
			<div class="top-stats">
				<div class="property-line first">
					<h4>Armor Class</h4>
					<p><$!this.ac$></p>
				</div> <!-- property line -->
				<div class="property-line">
					<h4>Hit Points</h4>
					<p><$!this.hp$></p>
				</div> <!-- property line -->
				<div class="property-line last">
					<h4>Speed</h4>
					<p><$!this.speed$></p>
				</div> <!-- property line -->
				<svg height="5" width="100%" class="tapered-rule">
			<polyline points="0,0 400,2.5 0,5"></polyline>
		  </svg>
				<div class="abilities">
					<div class="ability-strength">
						<h4>STR</h4>
						<p><$!this.str$></p>
					</div> <!-- ability strength -->
					<div class="ability-dexterity">
						<h4>DEX</h4>
						<p><$!this.dex$></p>
					</div> <!-- ability dexterity -->
					<div class="ability-constitution">
						<h4>CON</h4>
						<p><$!this.con$></p>
					</div> <!-- ability constitution -->
					<div class="ability-intelligence">
						<h4>INT</h4>
						<p><$!this.int$></p>
					</div> <!-- ability intelligence -->
					<div class="ability-wisdom">
						<h4>WIS</h4>
						<p><$!this.wis$></p>
					</div> <!-- ability wisdom -->
					<div class="ability-charisma">
						<h4>CHA</h4>
						<p><$!this.cha$></p>
					</div> <!-- ability charisma -->
				</div> <!-- abilities -->
				<svg height="5" width="100%" class="tapered-rule">
			<polyline points="0,0 400,2.5 0,5"></polyline>
		  </svg>
				<div class="property-line first">
					<h4>Saving Throws</h4>
					<p><$!this.savingthrows$></p>
				</div> <!-- property line -->
				<div class="property-line first">
					<h4>Skills</h4>
					<p><$!this.skills$></p>
				</div> <!-- property line -->
				<div class="property-line first">
					<h4>Damage Resistances</h4>
					<p><$!this.dmgresist$></p>
				</div> <!-- property line -->
				<div class="property-line first">
					<h4>Damage Immunities</h4>
					<p><$!this.dmgimmune$></p>
				</div> <!-- property line -->
				<div class="property-line">
					<h4>Condition Immunities</h4>
					<p><$!this.condimmune$></p>
				</div> <!-- property line -->
				<div class="property-line first">
					<h4>Vulnerabilities</h4>
					<p><$!this.vuln$></p>
				</div> <!-- property line -->
				<div class="property-line">
					<h4>Senses</h4>
					<p><$!this.senses$>, passive Perception <$!this.passive$></p>
				</div> <!-- property line -->
				<div class="property-line">
					<h4>Languages</h4>
					<p><$!this.languages$></p>
				</div> <!-- property line -->
				<div class="property-line last">
					<h4>Challenge</h4>
					<p><$!this.cr$></p>
				</div> <!-- property line -->
			</div> <!-- top stats -->
			<svg height="5" width="100%" class="tapered-rule">
			<polyline points="0,0 400,2.5 0,5"></polyline>
		  </svg>
		<$ for(p=0;p<this.trait.length;p++) { $>
			<div class="property-block">
				<h4><$!this.trait[p].name$></h4>
				<p><$ for(t=0;t<this.trait[p].text.length;t++) { $>
					<span class="trait">
						<$!this.trait[p].text[t]$>
					</span>
				<$ } $></p>
			</div> <!-- property block -->
		<$ } $>
		</div> <!-- section left -->
		<div class="section-right">
			<div class="actions">
				<h3>Actions</h3>
			<$ for(p=0;p<this.action.length;p++) { $>
				<div class="property-block">
					<h4><$!this.action[p].name$></h4>
					<p>
					<$ for(t=0;t<this.action[p].text.length;t++) { $>
						<$!this.action[p].text[t]$>
					<$ } $>
					<$ for(t=0;t<this.action[p].attack.length;t++) { $>
						<$ var hit = this.action[p].attack[t].split("|"); $>
						<i><$!hit[0]$></i>: +<$!hit[1]$>, <i>Hit:</i> <$!hit[2]$> damage.
					<$ } $>
					</p>
				</div> <!-- property block -->
			<$ } $>
			</div> <!-- actions -->
			<div class="actions">
				<h3>Legendary Actions</h3>
			<$ for(p=0;p<this.legendary.length;p++) { $>
				<div class="property-block">
					<h4><$!this.legendary[p].name$></h4>
					<p>
					<$ for(t=0;t<this.legendary[p].text.length;t++) { $>
						<$!this.legendary[p].text[t]$>
					<$ } $>
					<$ for(t=0;t<this.legendary[p].attack.length;t++) { $>
						<$ var hit = this.legendary[p].attack[t].split("|"); $>
						<i><$!hit[0]$></i>:
							<$!(hit[1]>0) ? "+" + hit[1] : hit[1]$>,
						<i>Hit:</i>
							<$!hit[2]$> damage.
					<$ } $>
					</p>
				</div> <!-- property block -->
			<$ } $>
			</div> <!-- actions -->
		</div> <!-- section right -->
		<hr class="orange-border bottom" />
	</div> <!-- stat block -->
	]]>
	</script>`;

	d20plus.settingsHtml = `<hr>
	<h3>Roll20 Plus v` + d20plus.version + `</h3>
	<p>
		<label>Import <span style="color:red;">OGL Sheet ONLY!</span></label>
		<a class="btn" href="#" id="d20plus-btn-im">Import Monsters</a>
	</p>
	<p>
		<label>Select your character sheet</label>
		<select class="d20plus-sheet" style="width: 150px;">
			<option value="ogl">5th Edition ( OGL by Roll20 )</option>
			<option value="community">5th Edition (Community Contributed)</option>
		</select>
	</p>`;

	d20plus.cssRules = [
		{s: "#initiativewindow ul li span.initiative,#initiativewindow ul li span.ac,#initiativewindow ul li span.hp,#initiativewindow ul li span.pp,#initiativewindow ul li span.cr",
			r: "font-size: 25px;font-weight: bold;text-align: right;float: right;padding: 5px;width: 10%;min-height: 20px;"},
		{s: "#initiativewindow ul li span.editable input",
			r: "width: 100%; box-sizing: border-box;height: 100%;"},
		{s: "#initiativewindow div.header",
			r: "height: 30px;"},
		{s: "#initiativewindow div.header span",
			r: "cursor: default;font-size: 15px;font-weight: bold;text-align: right;float: right;width: 10%;min-height: 20px;padding: 5px;"}
	];

	d20plus.initiativeHeaders = `<div class="header">
		<span class="initiative" alt="Initiative" title="Initiative">Init</span>
		<span class="pp" alt="Passive Perception" title="Passive Perception">Pass</span>
		<span class="ac" alt="AC" title="AC">AC</span>
		<span class="cr" alt="CR" title="CR">CR</span>
		<span class="hp" alt="HP" title="HP">HP</span>
	</div>`;

	d20plus.initiativeTemplate = `<script id="tmpl_initiativecharacter" type="text/html">
	<![CDATA[
	<li class='token <$ if (this.layer == "gmlayer") { $>gmlayer<$ } $>' data-tokenid='<$!this.id$>' data-currentindex='<$!this.idx$>'>
		<span alt='Initiative' title='Initiative' class='initiative <$ if (this.iseditable) { $>editable<$ } $>'>
			<$!this.pr$>
		</span>
		<$ var token = d20.Campaign.pages.get(d20.Campaign.activePage()).thegraphics.get(this.id); $>
		<$ var char = token.character; $>
		<span class='pp' alt='Passive Perception' title='Passive Perception'><$!char.autoCalcFormula('||PP||')$></span>
		<span class='ac' alt='AC' title='AC'><$!char.autoCalcFormula('||AC||')$></span>
		<span class='cr' alt='CR' title='CR'><$!char.autoCalcFormula('||CR||')$></span>
		<span class='hp editable' alt='HP' title='HP'>
		<$ var npc = char.attribs.find(function(a){return a.get("name").toLowerCase() == "npc" }); $>
		<$ if(npc && npc.get("current") == "1") { $>
			<$!token.attributes.bar3_value$>
		<$ } else { $>
			<$!char.autoCalcFormula('||HP||')$>
		<$ } $>
		</span>
		<$ if (this.avatar) { $><img src='<$!this.avatar$>' /><$ } $>
		<span class='name'><$!this.name$></span>
		<div class='clear' style='height: 0px;'></div>
		<div class='controls'>
			<span class='pictos remove'>#</span>
		</div>
	</li>
	]]>
	</script>`;
	/*  */

	/* object.watch polyfill by Eli Grey, http://eligrey.com */
	if (!Object.prototype.watch) {
		Object.defineProperty(Object.prototype, "watch", {
			enumerable: false,
			configurable: true,
			writable: false,
			value: function (prop, handler) {
				var
				oldval = this[prop],
				newval = oldval,
				getter = function () {
					return newval;
				},
				setter = function (val) {
					oldval = newval;
					return (newval = handler.call(this, prop, oldval, val));
				};

				if (delete this[prop]) {
					Object.defineProperty(this, prop, {
						get: getter,
						set: setter,
						enumerable: true,
						configurable: true
					});
				}
			}
		});
	}

	if (!Object.prototype.unwatch) {
		Object.defineProperty(Object.prototype, "unwatch", {
			enumerable: false,
			configurable: true,
			writable: false,
			value: function (prop) {
				var val = this[prop];
				delete this[prop];
				this[prop] = val;
			}
		});
	}
	/* end object.watch polyfill */

	window.d20ext = {};
	window.watch("d20ext", function (id, oldValue, newValue) {
		d20plus.log("> Set Development");
		newValue.environment = "development";
		return newValue;
	});

	window.d20 = {};
	window.watch("d20", function (id, oldValue, newValue) {
		d20plus.log("> Obtained d20 variable");
		window.unwatch("d20ext");
		window.d20ext.environment = "production";
		newValue.environment = "production";
		return newValue;
	});

	d20plus.log("> Injected");
};

// Inject
if (window.top == window.self)
	unsafeWindow.eval("(" + Roll20Plus.toString() + ")('" + GM_info.script.version + "')");